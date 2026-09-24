import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { withScope } from "@pos/database";
import type { DbPort, DbPrinter, DbPrintJob } from "../../common/db.port";
import { SalesService } from "../../sales/nest/sales.service";
import { escposReceipt } from "../escpos";

const PRINT_MANAGERS = new Set(["owner", "manager"]);
const SELL_ROLES = new Set(["owner", "manager", "cashier"]);

export interface PrinterView {
  id: string;
  businessId: string;
  branchId: string | null;
  name: string;
  width: string;
  connection: string;
}

// Responses never carry agentTokenHash: it is verifier material, not a field
// any client needs.
function printerView(row: DbPrinter): PrinterView {
  return {
    id: row.id,
    businessId: row.businessId,
    branchId: row.branchId,
    name: row.name,
    width: row.width,
    connection: row.connection,
  };
}

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
  ): Promise<PrinterView & { agentToken: string }> {
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
    const { agentToken, agentTokenHash } = mintAgentToken();
    const row = await this.db.createPrinter({ businessId, branchId, name, width, connection, agentTokenHash });
    await this.db.appendAudit({
      businessId, actorId, action: "printer.enroll",
      entityType: "PrinterDevice", entityId: row.id, requestId,
    });
    // The agent token is returned exactly once; only its hash is stored.
    return { ...printerView(row), agentToken };
  }

  async listPrinters(businessId: string): Promise<PrinterView[]> {
    withScope(businessId, {});
    return (await this.db.listPrinters(businessId)).map(printerView);
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
      // Receipt customization is a paid feature the business can store; the
      // printed receipt must actually show it.
      const settings = await this.db.getSettings(businessId);
      const header = typeof settings["receiptHeader"] === "string" ? settings["receiptHeader"] : null;
      const footer = typeof settings["receiptFooter"] === "string" ? settings["receiptFooter"] : null;
      const bytes = escposReceipt({
        businessName: business.name,
        receiptNo: receipt.receiptNo,
        header,
        footer,
        lines: receipt.items.map((l) => ({
          name: l.name,
          qty: l.qty,
          priceMinor: l.priceMinor,
          lineTotalMinor: Math.max(0, l.qty * l.priceMinor - l.lineDiscountMinor),
        })),
        totalMinor: receipt.totalMinor,
        subtotalMinor: receipt.subtotalMinor,
        discountMinor: receipt.discountMinor,
        taxMinor: receipt.taxMinor,
        paidMinor: receipt.paidMinor,
        changeMinor: receipt.changeMinor,
        layout,
      });
      payload = Buffer.from(bytes).toString("base64");
    }
    const row = await this.db.createPrintJob({
      businessId, printerId: printer.id, receiptNo, layout,
      status: "QUEUED", payload, attempts: 0, createdAt: new Date(),
    });
    await this.db.appendAudit({
      businessId, actorId, action: "print.queue",
      entityType: "PrintJob", entityId: row.id, requestId,
    });
    return row;
  }

  // Pickup is a device operation: the caller proves it holds this printer's
  // agent token, not merely some staff session in the same business.
  async claimNextJob(printerId: string, agentToken: string | undefined): Promise<DbPrintJob> {
    if (!agentToken) throw new Error("TENANT_REQUIRED");
    const printer = await this.db.findPrinterByAgentTokenHash(sha256Hex(agentToken));
    if (!printer || printer.id !== printerId) throw new Error("TENANT_REQUIRED");
    const businessId = printer.businessId;
    withScope(businessId, {});
    const queued = (await this.db.listPrintJobs(businessId, "QUEUED"))
      .filter((j) => j.printerId === printerId)
      .sort((a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
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

// Paired-agent token: prn_<8 hex prefix>_<32 hex secret>, shown once at
// enrollment and stored only as a hash, like display and API tokens.
export function mintAgentToken(): { agentToken: string; agentTokenHash: string } {
  const secret = randomBytes(16).toString("hex");
  const agentToken = `prn_${randomBytes(4).toString("hex")}_${secret}`;
  return { agentToken, agentTokenHash: sha256Hex(agentToken) };
}
