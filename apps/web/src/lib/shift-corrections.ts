import { pesosInputToMinor } from "./money";

export interface CorrectionRow {
  id: string;
  amountMinor: number;
  reason: string;
  actorId: string;
  createdAt: string;
}

export interface CorrectionInput {
  amountMinor: number;
  reason: string;
}

const REASON_MIN = 3;
const REASON_MAX = 200;

/** Corrections rewrite the expected cash of a shift that can no longer move, so the API reserves them for closers. */
export function canRecordCorrection(permissions: readonly string[], status: string): boolean {
  return permissions.includes("shift.close.override") && status === "CLOSED";
}

export function parseCorrection(amountInput: string, reasonInput: string): { ok: CorrectionInput } | { fieldError: string } {
  const amount = amountInput.trim();
  const reason = reasonInput.trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return { fieldError: `Reason must be ${REASON_MIN} to ${REASON_MAX} characters.` };
  }
  if (amount !== "" && pesosInputToMinor(amount) === null) {
    return { fieldError: "Amounts are in whole centavos." };
  }
  const amountMinor = pesosInputToMinor(amount);
  if (amountMinor === null || amountMinor === 0) {
    return { fieldError: "Enter a non-zero amount." };
  }
  return { ok: { amountMinor, reason } };
}
