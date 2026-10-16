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
  it("manages branch/default setup, test prints, agent presence, and explicit requeue", async () => {
    const db = createMemoryDb();
    const service = new PrintService(db);
    const business = await db.createBusiness({ name: "Printer Shop", currency: "PHP" });
    const branch = await db.createBranch({ businessId: business.id, name: "Mall Branch", type: "STORE", isActive: true });

    const enrolled = await service.enrollPrinter(business.id, "owner-1", "printer-r1", {
      name: "Front Till",
      width: "80",
      connection: "manual",
    }, "owner");
    agentSecrets.set(enrolled.id, enrolled.agentToken);
    expect(enrolled.agentToken).toMatch(/^prn_/);
    expect((await service.listPrinters(business.id))[0]).toMatchObject({
      id: enrolled.id,
      isDefault: false,
      agentStatus: "never",
      lastSeenAt: null,
    });

    await service.updatePrinter(business.id, "owner-1", "printer-r2", enrolled.id, {
      name: "Mall Front Till",
      width: "58",
      branchId: branch.id,
    }, "owner");
    await service.setDefaultPrinter(business.id, "owner-1", "printer-r3", enrolled.id, "owner");
    expect((await service.listPrinters(business.id))[0]).toMatchObject({
      name: "Mall Front Till",
      width: "58",
      branchId: branch.id,
      isDefault: true,
    });

    const testJob = await service.queueTestJob(business.id, "owner-1", "printer-r4", enrolled.id, "owner");
    expect(testJob.status).toBe("QUEUED");
    expect(Buffer.from(testJob.payload, "base64").toString("ascii")).toContain("NEXPOS PRINTER TEST");

    const sent = await service.claimNextJob(enrolled.id, agentOf(db, enrolled.id));
    expect(sent.id).toBe(testJob.id);
    const online = (await service.listPrinters(business.id))[0]!;
    expect(online.agentStatus).toBe("online");
    expect(online.lastSeenAt).toBeInstanceOf(Date);

    const retried = await service.retryJob(business.id, "owner-1", "printer-r5", testJob.id, "owner");
    expect(retried.id).not.toBe(testJob.id);
    expect(retried.status).toBe("QUEUED");
    expect(retried.payload).toBe(testJob.payload);
    const jobs = await service.listJobs(business.id, enrolled.id, "owner");
    expect(jobs.items.map((job) => job.status)).toEqual(["QUEUED", "SENT"]);

    await expect(service.setDefaultPrinter(business.id, "cashier-1", "printer-r6", enrolled.id, "cashier")).rejects.toThrow("FORBIDDEN");
  });

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

  it("prints the stored receipt header and footer", async () => {
    const db = createMemoryDb();
    const service = new PrintService(db);
    const business = await db.createBusiness({ name: "Custom Shop", currency: "PHP" });
    const { agentTokenHash } = mintAgentToken();
    const printer = await db.createPrinter({
      businessId: business.id, branchId: null, name: "Till 1", width: "80",
      connection: "test-double", agentTokenHash,
    });
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Item", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 500, priceMinor: 1500, taxRateBps: null,
      reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null,
    });
    await db.saveSettings(business.id, {
      ...(await db.getSettings(business.id)),
      receiptHeader: "Salamat Shop",
      receiptFooter: "Salamat ulit kayo",
    });
    const { SalesService } = await import("../../sales/nest/sales.service");
    const sales = new SalesService(db);
    const draft = await sales.createDraft(business.id, "u1", "r1", {
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, []);
    const done = await sales.completeSale(business.id, "u1", "r1", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "custom-receipt", granted: [],
    });
    const job = await service.queueJob(business.id, "u1", "r2", {
      printerId: printer.id, receiptNo: done.sale.receiptNo,
    }, "owner");
    const text = Buffer.from(job.payload, "base64").toString("ascii");
    expect(text).toContain("Salamat Shop");
    expect(text).toContain("Salamat ulit kayo");

    const free = await db.findPlanByKey("free");
    expect(free).toBeTruthy();
    await db.upsertSubscription({
      businessId: business.id, planId: free!.id, status: "active",
      trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    const standard = await service.queueJob(business.id, "u1", "r3", {
      printerId: printer.id, receiptNo: done.sale.receiptNo,
    }, "owner");
    const standardText = Buffer.from(standard.payload, "base64").toString("ascii");
    expect(standardText).toContain("Custom Shop");
    expect(standardText).not.toContain("Salamat Shop");
    expect(standardText).not.toContain("Salamat ulit kayo");
  });

  it("rejects a receipt queued to a printer assigned to another branch but allows an unassigned printer", async () => {
    const db = createMemoryDb();
    const service = new PrintService(db);
    const business = await db.createBusiness({ name: "Branch Print Shop", currency: "PHP" });
    const branchA = await db.createBranch({ businessId: business.id, name: "Branch A", type: "store", isActive: true });
    const branchB = await db.createBranch({ businessId: business.id, name: "Branch B", type: "store", isActive: true });
    const { agentTokenHash } = mintAgentToken();
    const wrongBranchPrinter = await db.createPrinter({
      businessId: business.id, branchId: branchB.id, name: "Branch B Printer", width: "80",
      connection: "manual", agentTokenHash,
    });
    const unassignedPrinter = await db.createPrinter({
      businessId: business.id, branchId: null, name: "Shared Printer", width: "80",
      connection: "manual", agentTokenHash: null,
    });
    const product = await db.createProduct({
      businessId: business.id, categoryId: null, name: "Branch Item", sku: null, barcode: null,
      brand: null, unit: "pc", costMinor: 500, priceMinor: 1500, taxRateBps: null,
      reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null,
    });
    const { SalesService } = await import("../../sales/nest/sales.service");
    const sales = new SalesService(db);
    const draft = await sales.createDraft(business.id, "u1", "r1", {
      branchId: branchA.id,
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }],
      orderDiscountMinor: 0,
    }, []);
    const done = await sales.completeSale(business.id, "u1", "r1", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "branch-print-sale", granted: [],
    });

    await expect(service.queueJob(business.id, "u1", "r2", {
      printerId: wrongBranchPrinter.id, receiptNo: done.sale.receiptNo,
    }, "owner")).rejects.toThrow("FORBIDDEN");
    await expect(service.queueJob(business.id, "u1", "r3", {
      printerId: unassignedPrinter.id, receiptNo: done.sale.receiptNo,
    }, "owner")).resolves.toMatchObject({ printerId: unassignedPrinter.id });
  });
});
