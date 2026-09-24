import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { withScope } from "@pos/database";
import type { DbPort, DbPrinter, DbPrintJob } from "../../common/db.port";
import { SalesService } from "../../sales/nest/sales.service";
import { escposReceipt } from "../escpos";

const PRINT_MANAGERS = new Set(["owner", "manager"]);
const SELL_ROLES = new Set(["owner", "manager", "cashier"]);

export interface PrinterInput {
  name: string;
  branchId?: string;
  width?: string;
  connection?: string;
}

@Injectable()
export class PrintService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async enrollPrinter(
    businessId: string,
    actorId: string,
    requestId: string,
    input: PrinterInput,
    role: string,
  ): Promise<DbPrinter> {
    withScope(businessId, {});
    if (!PRINT_MANAGERS.has(role)) throw new Error("FORBIDDEN");
    const name = input.name.trim();
    if (!name) throw new Error("VALIDATION");
    const width = input.width ?? "80";
    if (width !== "58" && width !== "80") throw new Error("VALIDATION");
    const connection = input.connection ?? "test-double";
    if (connection !== "test-double" && connection !== "manual") throw new Error("VALIDATION");
    let branchId: string | null = null;
    if (input.branchId !== undefined) {
      const branch = await this.db.findBranchById(input.branchId, businessId);
      if (!branch) throw new Error("VALIDATION");
      branchId = branch.id;
    }
    const row = await this.db.createPrinter({ businessId, branchId, name, width, connection });
    await this.db.appendAudit({
      businessId, actorId, action: "printer.enroll",
      entityType: "PrinterDevice", entityId: row.id, requestId,
    });
    return row;
  }

  async listPrinters(businessId: string): Promise<DbPrinter[]> {
    withScope(businessId, {});
    return this.db.listPrinters(businessId);
  }

  async queueJob(
    businessId: string,
    actorId: string,
    requestId: string,
    input: { printerId: string; receiptNo?: string; layout?: string },
    role: string,
  ): Promise<DbPrintJob> {
    withScope(businessId, {});
    if (!SELL_ROLES.has(role)) throw new Error("FORBIDDEN");
    const printer = await this.db.findPrinterById(input.printerId, businessId);
    if (!printer) throw new Error("NOT_FOUND");
    const layout = input.layout ?? printer.width;
    if (layout !== "58" && layout !== "80") throw new Error("VALIDATION");
    let receiptNo = input.receiptNo ?? null;
    let payload = "";
    if (receiptNo) {
      const sales = new SalesService(this.db);
      const business = await this.db.findBusinessById(businessId);
      if (!business) throw new Error("NOT_FOUND");
      const found = (await this.db.listSalesByBusiness(businessId)).find(
        (s) => s.receiptNo === receiptNo,
      );
      if (!found) throw new Error("NOT_FOUND");
      const receipt = await sales.receiptData(businessId, found.id);
      const bytes = escposReceipt({
        businessName: business.name,
        receiptNo: receipt.receiptNo,
        lines: receipt.items.map((l) => ({ name: l.name, qty: l.qty, priceMinor: l.priceMinor })),
        totalMinor: receipt.totalMinor,
        paidMinor: receipt.paidMinor,
        changeMinor: receipt.changeMinor,
        layout,
      });
      payload = Buffer.from(bytes).toString("base64");
    }
    const row = await this.db.createPrintJob({
      businessId, printerId: printer.id, receiptNo, layout,
      status: "QUEUED", payload, attempts: 0,
    });
    await this.db.appendAudit({
      businessId, actorId, action: "print.queue",
      entityType: "PrintJob", entityId: row.id, requestId,
    });
    return row;
  }

  async claimNextJob(businessId: string, printerId: string): Promise<DbPrintJob> {
    withScope(businessId, {});
    const queued = (await this.db.listPrintJobs(businessId, "QUEUED"))
      .filter((j) => j.printerId === printerId)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const next = queued[0] ?? null;
    if (!next) throw new Error("NOT_FOUND");
    const claimed = await this.db.updatePrintJob(
      next.id, businessId, { status: "SENT", attempts: next.attempts + 1 }, "QUEUED",
    );
    if (!claimed) throw new Error("NOT_FOUND");
    await this.db.appendAudit({
      businessId, actorId: "printer-agent", action: "print.sent",
      entityType: "PrintJob", entityId: claimed.id, requestId: `pickup-${claimed.id}`,
    });
    return claimed;
  }
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
