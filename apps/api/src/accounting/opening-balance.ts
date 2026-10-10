import type { JournalDraft, JournalLineDraft } from "./accounting-types";
import { ACCOUNT_BY_CODE } from "./chart-of-accounts";
import { buildBalancedDraft } from "./journal-rules";

export interface OpeningBalanceLineInput {
  accountCode: string;
  debitMinor: number;
  creditMinor: number;
}

/** Build owner-entered opening balances without inferring values from operations. */
export function buildOpeningBalanceDraft(input: {
  accountingStartAt: Date;
  currency: string;
  lines: OpeningBalanceLineInput[];
  accounts?: Array<{ code: string; type: string; isActive: boolean }>;
}): JournalDraft {
  if (!(input.accountingStartAt instanceof Date) || Number.isNaN(input.accountingStartAt.getTime())) {
    throw new Error("ACCOUNTING_INVALID_DATE");
  }
  if (!input.lines.length) throw new Error("ACCOUNTING_INVALID_ENTRY");

  let debitTotal = 0;
  let creditTotal = 0;
  const lines: JournalLineDraft[] = [];
  for (const line of input.lines) {
    const account = input.accounts ? input.accounts.find((candidate) => candidate.code === line.accountCode) : ACCOUNT_BY_CODE[line.accountCode];
    if (!account || ("isActive" in account && !account.isActive) || !["asset", "liability", "equity"].includes(account.type) || line.accountCode === "3000") {
      throw new Error("ACCOUNTING_INVALID_OPENING_ACCOUNT");
    }
    if (!Number.isSafeInteger(line.debitMinor) || !Number.isSafeInteger(line.creditMinor) || line.debitMinor < 0 || line.creditMinor < 0 || (line.debitMinor === 0) === (line.creditMinor === 0)) {
      throw new Error("ACCOUNTING_INVALID_AMOUNT");
    }
    debitTotal += line.debitMinor;
    creditTotal += line.creditMinor;
    if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal)) throw new Error("ACCOUNTING_INVALID_AMOUNT");
    lines.push({ accountCode: line.accountCode, debitMinor: line.debitMinor, creditMinor: line.creditMinor, memo: "Owner-confirmed opening balance" });
  }

  if (debitTotal > creditTotal) lines.push({ accountCode: "3000", debitMinor: 0, creditMinor: debitTotal - creditTotal, memo: "Opening retained earnings offset" });
  if (creditTotal > debitTotal) lines.push({ accountCode: "3000", debitMinor: creditTotal - debitTotal, creditMinor: 0, memo: "Opening retained earnings offset" });
  return buildBalancedDraft({
    effectiveAt: input.accountingStartAt,
    currency: input.currency,
    description: "Owner-confirmed opening balances",
    lines,
  });
}
