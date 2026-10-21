import { pesosInputToMinor } from "./money";

export interface GiftCardAdjustInput {
  amountMinor: number;
  reason: string;
}

const REASON_MIN = 3;
const REASON_MAX = 500;

export function parseGiftCardAdjust(amountInput: string, reasonInput: string): { ok: GiftCardAdjustInput } | { fieldError: string } {
  const reason = reasonInput.trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return { fieldError: `Reason must be ${REASON_MIN} to ${REASON_MAX} characters.` };
  }
  if (amountInput.trim() !== "" && pesosInputToMinor(amountInput) === null) {
    return { fieldError: "Amounts are in whole centavos." };
  }
  const amountMinor = pesosInputToMinor(amountInput);
  if (amountMinor === null || amountMinor === 0) {
    return { fieldError: "Enter a non-zero amount." };
  }
  return { ok: { amountMinor, reason } };
}

export function canApplyValueAdjustment(permissions: readonly string[]): boolean {
  return permissions.includes("stored_value.adjust");
}

export function canChangeCardStatus(permissions: readonly string[]): boolean {
  return permissions.includes("gift_card.manage");
}

export function nextCardStatus(status: string): "ACTIVE" | "SUSPENDED" {
  return status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
}
