export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type NormalSide = "debit" | "credit";

export interface AccountingAccountDefinition {
  code: string;
  name: string;
  type: AccountType;
  normalSide: NormalSide;
  system: true;
}

export interface JournalLineDraft {
  accountCode: string;
  debitMinor: number;
  creditMinor: number;
  memo?: string;
}

export interface JournalDraft {
  effectiveAt: Date;
  currency: string;
  description: string;
  lines: JournalLineDraft[];
}

export interface SourceEventIdentity {
  businessId: string;
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
}

export interface JournalTotals {
  debitMinor: number;
  creditMinor: number;
}

export type PostingTender = { method: string; amountMinor: number };
