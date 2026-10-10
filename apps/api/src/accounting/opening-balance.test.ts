import { describe, expect, it } from "vitest";
import { buildOpeningBalanceDraft } from "./opening-balance";
import { validateJournalDraft } from "./journal-rules";

describe("opening balance worksheet", () => {
  const date = new Date("2026-01-01T00:00:00.000Z");

  it("adds retained earnings credit for owner-entered net assets", () => {
    const draft = buildOpeningBalanceDraft({
      accountingStartAt: date,
      currency: "PHP",
      lines: [{ accountCode: "1000", debitMinor: 50_000, creditMinor: 0 }, { accountCode: "2000", debitMinor: 0, creditMinor: 12_000 }],
    });
    expect(draft.lines).toContainEqual({ accountCode: "3000", debitMinor: 0, creditMinor: 38_000, memo: "Opening retained earnings offset" });
    expect(validateJournalDraft(draft)).toEqual({ debitMinor: 50_000, creditMinor: 50_000 });
  });

  it("adds retained earnings debit when entered credits exceed debits", () => {
    const draft = buildOpeningBalanceDraft({ accountingStartAt: date, currency: "PHP", lines: [{ accountCode: "2000", debitMinor: 0, creditMinor: 5_000 }] });
    expect(draft.lines.at(-1)).toEqual({ accountCode: "3000", debitMinor: 5_000, creditMinor: 0, memo: "Opening retained earnings offset" });
  });

  it("rejects P&L accounts, retained earnings input, zero lines, and unsafe totals", () => {
    expect(() => buildOpeningBalanceDraft({ accountingStartAt: date, currency: "PHP", lines: [{ accountCode: "4000", debitMinor: 1, creditMinor: 0 }] })).toThrow("ACCOUNTING_INVALID_OPENING_ACCOUNT");
    expect(() => buildOpeningBalanceDraft({ accountingStartAt: date, currency: "PHP", lines: [{ accountCode: "3000", debitMinor: 1, creditMinor: 0 }] })).toThrow("ACCOUNTING_INVALID_OPENING_ACCOUNT");
    expect(() => buildOpeningBalanceDraft({ accountingStartAt: date, currency: "PHP", lines: [{ accountCode: "1000", debitMinor: 0, creditMinor: 0 }] })).toThrow("ACCOUNTING_INVALID_AMOUNT");
    expect(() => buildOpeningBalanceDraft({ accountingStartAt: date, currency: "PHP", lines: [{ accountCode: "1000", debitMinor: Number.MAX_SAFE_INTEGER, creditMinor: 0 }, { accountCode: "1400", debitMinor: 1, creditMinor: 0 }] })).toThrow("ACCOUNTING_INVALID_AMOUNT");
  });

  it("accepts active owner-defined balance-sheet accounts", () => {
    const draft = buildOpeningBalanceDraft({
      accountingStartAt: date,
      currency: "PHP",
      accounts: [{ code: "CUST-ASSET", type: "asset", isActive: true }],
      lines: [{ accountCode: "CUST-ASSET", debitMinor: 2_000, creditMinor: 0 }],
    });
    expect(draft.lines[0]?.accountCode).toBe("CUST-ASSET");
  });
});
