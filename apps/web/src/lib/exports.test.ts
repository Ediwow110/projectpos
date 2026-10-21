import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("csv export consumers", () => {
  it("hides exports from a session without the export grant", async () => {
    const { canExport } = await import("./exports");
    expect(canExport(["sale.read"])).toBe(false);
    expect(canExport(["export.run"])).toBe(true);
  });

  it("carries only the range the reviewer actually chose", async () => {
    const { ledgerDownloadUrl } = await import("./exports");
    expect(ledgerDownloadUrl({ dateFrom: "", dateTo: "" })).toContain("format=csv");
    expect(ledgerDownloadUrl({ dateFrom: "", dateTo: "" })).not.toContain("dateFrom");
    const ranged = ledgerDownloadUrl({ dateFrom: "2026-10-01", dateTo: "2026-10-07" });
    expect(ranged).toContain("dateFrom=2026-10-01");
    expect(ranged).toContain("dateTo=2026-10-07");
  });

  it("cannot smuggle an extra query parameter through a date field", async () => {
    const { ledgerDownloadUrl } = await import("./exports");
    const hostile = ledgerDownloadUrl({ dateFrom: "2026-10-01&businessId=other", dateTo: "" });
    expect(hostile).not.toContain("&businessId=other");
    expect(hostile).toContain("2026-10-01%26businessId%3Dother");
  });

  it("routes the expenses export at the endpoint that serves it", async () => {
    const { expensesDownloadUrl } = await import("./exports");
    expect(expensesDownloadUrl({ category: "" })).toContain("/api/v1/expenses/export?format=csv");
    expect(expensesDownloadUrl({ category: "" })).not.toContain("category");
  });

  it("sends the category the reviewer filtered by, encoded", async () => {
    const { expensesDownloadUrl } = await import("./exports");
    expect(expensesDownloadUrl({ category: "Rent" })).toContain("category=Rent");
    expect(expensesDownloadUrl({ category: " a & b " })).toContain("category=a+%26+b");
    expect(expensesDownloadUrl({ category: "x&format=json" })).not.toContain("&format=json");
  });

  it("states the same page cap the expenses export serves", async () => {
    const { EXPENSES_ROW_WINDOW } = await import("./exports");
    const controller = readFileSync(resolve(process.cwd(), "../../apps/api/src/expenses/nest/expense.controller.ts"), "utf8");
    const declared = controller.match(/EXPENSE_EXPORT_ROW_LIMIT = (\d+)/);
    expect(declared, "the API must name its export row ceiling").not.toBeNull();
    expect(EXPENSES_ROW_WINDOW).toBe(Number(declared?.[1]));
  });

  it("states the same row window the server enforces", async () => {
    const { LEDGER_ROW_WINDOW } = await import("./exports");
    const controller = readFileSync(resolve(process.cwd(), "../../apps/api/src/exports/nest/export.controller.ts"), "utf8");
    const declared = controller.match(/LEDGER_EXPORT_ROW_WINDOW = (\d+)/);
    expect(declared, "the API must declare its ledger row window").not.toBeNull();
    expect(LEDGER_ROW_WINDOW).toBe(Number(declared?.[1]));
  });
});
