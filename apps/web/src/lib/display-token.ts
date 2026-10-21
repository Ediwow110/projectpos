import { ApiError } from "./api";
import { errorText } from "./billing";

/** Mirrors the API's own minting lifetime for a customer-display token. */
export const DISPLAY_TOKEN_MINUTES = 15;

const PAIRING_ROLES = new Set(["owner", "manager", "cashier"]);

export function canPairCustomerDisplay(role: string): boolean {
  return PAIRING_ROLES.has(role);
}

export function displayLink(origin: string, registerId: string, token: string): string {
  const params = new URLSearchParams({ registerId, token });
  return `${origin}/display?${params.toString()}`;
}

export function displayPairFailureCopy(error: unknown): string {
  if (error instanceof ApiError && error.code === "FORBIDDEN") {
    return "Only a signed-in seller can pair a customer display.";
  }
  if (error instanceof ApiError && error.code === "NOT_FOUND") {
    return "That register no longer exists, so no display link could be issued for it.";
  }
  return errorText(error, "The display link could not be created.");
}
