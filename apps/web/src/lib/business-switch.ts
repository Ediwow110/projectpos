import { ApiError } from "./api";
import { errorText } from "./billing";

export interface BusinessOption {
  businessId: string;
  name: string;
  role: string;
  active: boolean;
}

/** The workspace the caller is standing in reads as the first option. */
export function orderedBusinesses(items: readonly BusinessOption[]): BusinessOption[] {
  return [...items].sort((left, right) => Number(right.active) - Number(left.active));
}

export function switchFailureCopy(error: unknown): string {
  if (error instanceof ApiError && error.code === "TENANT_MISMATCH") {
    return "That business is no longer available to this account.";
  }
  if (error instanceof ApiError && error.code === "SESSION_REVOKED") {
    return "This session was revoked. Sign in again to switch workspaces.";
  }
  return errorText(error, "The workspace could not be switched.");
}
