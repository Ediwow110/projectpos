import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import type { DbPort } from "../../common/db.port";
import { PrintService, mintAgentToken } from "./print.service";

const agentSecrets = new Map<string, string>();

function agentOf(_db: DbPort, printerId: string): string {
  const secret = agentSecrets.get(printerId);
  if (!secret) throw new Error("no agent token minted for printer");
  return secret;
}

async function setup() {
  const db = createMemoryDb();
  const service = new PrintService(db);
  const { agentToken, agentTokenHash } = mintAgentToken();
  const printer = await db.createPrinter({ businessId: "b1", branchId: null, name: "Till 1", width: "80", connection: "test-double", agentTokenHash });
  agentSecrets.set(printer.id, agentToken);
  return { db, service, printer };
}

describe("phase10 print jobs", () => {
  it("claims queued jobs in creation order, not id order", async () => {
    const { db, service, printer } = await setup();
    const later = await db.createPrintJob({
      businessId: "b1", printerId: printer.id, receiptNo: null, layout: "80",
      status: "QUEUED", payload: "", attempts: 0,
      createdAt: new Date("2026-09-24T10:00:02.000Z"),
    });
    const earlier = await db.createPrintJob({
      businessId: "b1", printerId: printer.id, receiptNo: null, layout: "80",
      status: "QUEUED", payload: "", attempts: 0,
      createdAt: new Date("2026-09-24T10:00:01.000Z"),
    });
    expect(later.id < earlier.id).toBe(true);

    const first = await service.claimNextJob(printer.id, agentOf(db, printer.id));
    expect(first.id).toBe(earlier.id);
    expect(first.attempts).toBe(1);
    expect(first.status).toBe("SENT");

    const second = await service.claimNextJob(printer.id, agentOf(db, printer.id));
    expect(second.id).toBe(later.id);
  });

  it("refuses a second claim of the same job", async () => {
    const { db, service, printer } = await setup();
    const job = await db.createPrintJob({
      businessId: "b1", printerId: printer.id, receiptNo: null, layout: "80",
      status: "QUEUED", payload: "", attempts: 0,
      createdAt: new Date("2026-09-24T10:00:01.000Z"),
    });
    await service.claimNextJob(printer.id, agentOf(db, printer.id));
    await expect(db.updatePrintJob(job.id, "b1", { status: "FAILED" }, "QUEUED")).resolves.toBeNull();
    await expect(service.claimNextJob(printer.id, agentOf(db, printer.id))).rejects.toThrow("NOT_FOUND");
  });

  it("keeps another tenant's queue invisible and requires the agent token", async () => {
    const { db, service, printer } = await setup();
    await db.createPrintJob({
      businessId: "b1", printerId: printer.id, receiptNo: null, layout: "80",
      status: "QUEUED", payload: "", attempts: 0, createdAt: new Date("2026-09-24T10:00:01.000Z"),
    });
    await expect(service.claimNextJob("prt_other", agentOf(db, printer.id))).rejects.toThrow("TENANT_REQUIRED");
    await expect(service.claimNextJob(printer.id, undefined)).rejects.toThrow("TENANT_REQUIRED");
    await expect(service.claimNextJob(printer.id, "prn_00000000_" + "0".repeat(32))).rejects.toThrow("TENANT_REQUIRED");
  });

  it("prints subtotal, discount and tax so a discounted sale reconciles", async () => {
    const db = createMemoryDb();
    const service = new PrintService(db);
    const business = await db.createBusiness({ name: "Receipt Shop", currency: "PHP" });
    const { agentTokenHash } = mintAgentToken();
    const printer = await db.createPrinter({
      businessId: business.id, branchId: null, name: "Till 1", width: "80",
      connection: "test-double", agentTokenHash,
    });
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Gadget", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 1000, priceMinor: 10000, taxRateBps: 1000,
      reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
    });
    await db.upsertBalance({ businessId: business.id, branchId: null, productId: product.id, qtyOnHand: 20 });
    const { SalesService } = await import("../../sales/nest/sales.service");
    const sales = new SalesService(db);
    const draft = await sales.createDraft(business.id, "u1", "r1", {
      lines: [{ productId: product.id, qty: 2, lineDiscountMinor: 0 }],
      orderDiscountMinor: 1000,
    }, ["discount.override"]);
    const done = await sales.completeSale(business.id, "u1", "r1", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "receipt-discount", granted: ["discount.override"],
    });
    const job = await service.queueJob(business.id, "u1", "r2", {
      printerId: printer.id, receiptNo: done.sale.receiptNo,
    }, "owner");
    const text = Buffer.from(job.payload, "base64").toString("ascii");
    expect(text).toContain("SUBTOTAL");
    expect(text).toContain("DISCOUNT");
    expect(text).toContain("TAX");
    // Whatever the tax basis is, the printed rows must reconcile to the total.
    expect(text).toContain((done.sale.totalMinor / 100).toFixed(2));
    expect(done.sale.taxMinor).toBeGreaterThan(0);
    expect(done.sale.subtotalMinor - done.sale.discountMinor + done.sale.taxMinor)
      .toBe(done.sale.totalMinor);
    expect(text).toContain((done.sale.subtotalMinor / 100).toFixed(2));
    expect(text).toContain((done.sale.taxMinor / 100).toFixed(2));
  });
});
