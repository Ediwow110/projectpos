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
  const checked = await api.check(cmd.key).catch(() => null);
  if (checked?.applied) return { status: 200, code: null, resultId: checked.resultId ?? null };
  const payload = cmd.payload as SaleCommandPayload;
  const draft = await api.createDraft(toDraftBody(payload));
  const body: CompleteBody = {
    saleId: draft.id,
    payments: payload.payments,
  };
  if (payload.registerId !== undefined) body.registerId = payload.registerId;
  return api.complete(cmd.key, body);
}
