import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { PrintService } from "./print.service";

async function setup() {
  const db = createMemoryDb();
  const service = new PrintService(db);
  const printer = await db.createPrinter({ businessId: "b1", branchId: null, name: "Till 1", width: "80", connection: "test-double" });
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

    const first = await service.claimNextJob("b1", printer.id);
    expect(first.id).toBe(earlier.id);
    expect(first.attempts).toBe(1);
    expect(first.status).toBe("SENT");

    const second = await service.claimNextJob("b1", printer.id);
    expect(second.id).toBe(later.id);
  });

  it("refuses a second claim of the same job", async () => {
    const { db, service, printer } = await setup();
    const job = await db.createPrintJob({
      businessId: "b1", printerId: printer.id, receiptNo: null, layout: "80",
      status: "QUEUED", payload: "", attempts: 0,
      createdAt: new Date("2026-09-24T10:00:01.000Z"),
    });
    await service.claimNextJob("b1", printer.id);
    await expect(db.updatePrintJob(job.id, "b1", { status: "FAILED" }, "QUEUED")).resolves.toBeNull();
    await expect(service.claimNextJob("b1", printer.id)).rejects.toThrow("NOT_FOUND");
  });

  it("keeps another tenant's queue invisible", async () => {
    const { db, service, printer } = await setup();
    await db.createPrintJob({
      businessId: "b1", printerId: printer.id, receiptNo: null, layout: "80",
      status: "QUEUED", payload: "", attempts: 0, createdAt: new Date("2026-09-24T10:00:01.000Z"),
    });
    await expect(service.claimNextJob("b2", printer.id)).rejects.toThrow("NOT_FOUND");
  });
});
