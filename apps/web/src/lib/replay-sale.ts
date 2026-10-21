import type { OutboxCommand } from "./sync-store";

export interface SaleCommandPayload {
  lines: Array<{ productId: string; qty: number }>;
  registerId?: string;
  customerId?: string;
  customerName?: string;
  branchId?: string;
  notes?: string;
  payments: Array<{ method: string; amountMinor: number }>;
}

export interface SaleSendResult {
  status: number;
  code: string | null;
  resultId: string | null;
}

export interface CompleteBody {
  saleId: string;
  payments: SaleCommandPayload["payments"];
  registerId?: string;
}

export interface SaleApi {
  /**
   * Asks the idempotency ledger what happened to this key. A refused, failed,
   * or never-sent check must REJECT rather than resolve: "could not ask" is not
   * an answer, and reading it as "not applied" would open a second sale for a
   * cart the server may already have recorded. pos-attempt.ts models the same
   * three-way split (applied / answered-not-applied / unanswered).
   */
  check: (key: string) => Promise<{ applied: boolean; resultId?: string }>;
  createDraft: (body: Omit<SaleCommandPayload, "payments">) => Promise<{ id: string; totalMinor: number }>;
  complete: (key: string, body: CompleteBody) => Promise<SaleSendResult>;
}

export function toDraftBody(payload: SaleCommandPayload): Omit<SaleCommandPayload, "payments"> {
  const { payments: _payments, ...draft } = payload;
  void _payments;
  return draft;
}

export async function sendSaleCommand(cmd: OutboxCommand, api: SaleApi): Promise<SaleSendResult> {
  // Timeout ambiguity first: a previous attempt may have applied server-side.
  // A check that was refused or never landed rejects here, so the command stays
  // in the outbox for retry instead of opening a second sale for a cart the
  // ledger may already hold. Only an answered "not applied" may draft.
  const checked = await api.check(cmd.key);
  if (checked.applied) return { status: 200, code: null, resultId: checked.resultId ?? null };
  const payload = cmd.payload as SaleCommandPayload;
  const draft = await api.createDraft(toDraftBody(payload));
  const body: CompleteBody = {
    saleId: draft.id,
    payments: payload.payments,
  };
  if (payload.registerId !== undefined) body.registerId = payload.registerId;
  return api.complete(cmd.key, body);
}
