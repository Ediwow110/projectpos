import { minorToMajorFixed } from "./money";

export interface LoyaltySettingsForm {
  enabled: boolean;
  earnAmount: string;
  earnPoints: string;
  redeemPoints: string;
  redeemValue: string;
  minimumRedeemPoints: string;
}

export interface LoyaltyProgramSettings {
  id: string;
  enabled: boolean;
  earnAmountMinor: number;
  earnPoints: number;
  redeemPoints: number;
  redeemValueMinor: number;
  minimumRedeemPoints: number | null;
  version: number;
  updatedAt: string;
}

export type LoyaltySettingsField = keyof Omit<LoyaltySettingsForm, "enabled">;
export type LoyaltySettingsErrors = Partial<Record<LoyaltySettingsField, string>>;

export function majorToMinor(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  return Number.isSafeInteger(minor) ? minor : null;
}

export function formatMajorCurrency(minor: number): string {
  return `₱${minorToMajorFixed(minor)}`;
}

function positiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function validateLoyaltySettings(form: LoyaltySettingsForm): LoyaltySettingsErrors {
  const errors: LoyaltySettingsErrors = {};
  if (majorToMinor(form.earnAmount) === null || (majorToMinor(form.earnAmount) ?? 0) <= 0) errors.earnAmount = "Enter a currency amount greater than ₱0.00.";
  if (positiveInteger(form.earnPoints) === null) errors.earnPoints = "Enter a whole number greater than 0.";
  if (positiveInteger(form.redeemPoints) === null) errors.redeemPoints = "Enter a whole number greater than 0.";
  if (majorToMinor(form.redeemValue) === null || (majorToMinor(form.redeemValue) ?? 0) <= 0) errors.redeemValue = "Enter a currency amount greater than ₱0.00.";
  if (form.minimumRedeemPoints.trim() !== "" && positiveInteger(form.minimumRedeemPoints) === null) errors.minimumRedeemPoints = "Leave this blank or enter a whole number greater than 0.";
  return errors;
}

export function formFromProgram(program: LoyaltyProgramSettings): LoyaltySettingsForm {
  return {
    enabled: program.enabled,
    earnAmount: minorToMajorFixed(program.earnAmountMinor),
    earnPoints: String(program.earnPoints),
    redeemPoints: String(program.redeemPoints),
    redeemValue: minorToMajorFixed(program.redeemValueMinor),
    minimumRedeemPoints: program.minimumRedeemPoints === null ? "" : String(program.minimumRedeemPoints),
  };
}

export function emptyLoyaltySettings(): LoyaltySettingsForm {
  return { enabled: false, earnAmount: "", earnPoints: "", redeemPoints: "", redeemValue: "", minimumRedeemPoints: "" };
}

export function loyaltyPayload(form: LoyaltySettingsForm): {
  enabled: boolean;
  earnAmountMinor: number;
  earnPoints: number;
  redeemPoints: number;
  redeemValueMinor: number;
  minimumRedeemPoints: number | null;
} | null {
  const errors = validateLoyaltySettings(form);
  if (Object.keys(errors).length > 0) return null;
  return {
    enabled: form.enabled,
    earnAmountMinor: majorToMinor(form.earnAmount) as number,
    earnPoints: Number.parseInt(form.earnPoints, 10),
    redeemPoints: Number.parseInt(form.redeemPoints, 10),
    redeemValueMinor: majorToMinor(form.redeemValue) as number,
    minimumRedeemPoints: form.minimumRedeemPoints.trim() === "" ? null : Number.parseInt(form.minimumRedeemPoints, 10),
  };
}

export function loyaltyExample(form: LoyaltySettingsForm): { earn: string; redeem: string } {
  const earnAmount = majorToMinor(form.earnAmount);
  const earnPoints = positiveInteger(form.earnPoints);
  const redeemPoints = positiveInteger(form.redeemPoints);
  const redeemValue = majorToMinor(form.redeemValue);
  return {
    earn: earnAmount !== null && earnPoints !== null ? `${formatMajorCurrency(earnAmount)} spend → ${earnPoints} points` : "Enter an earn rule",
    redeem: redeemPoints !== null && redeemValue !== null ? `${redeemPoints} points → ${formatMajorCurrency(redeemValue)}` : "Enter a redeem rule",
  };
}
