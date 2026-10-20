import { ROLE_SEED } from "../tenant/seed";

// These are deny-only exceptions to existing roles, not new permissions.
// Business Settings already persists JSON per tenant; no schema migration.
export const MEMBER_DENIALS_KEY = "memberPermissionDenials";
export const MEMBER_BRANCHES_KEY = "memberBranchAssignments";
export const MEMBER_REGISTERS_KEY = "memberRegisterAssignments";

/** Undefined means legacy all-branch access. An empty/corrupt assignment fails closed. */
export function assignedBranches(
  settings: Record<string, unknown>,
  membershipId: string,
): string[] | undefined {
  const entries = settings[MEMBER_BRANCHES_KEY];
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(entries, membershipId)) return undefined;
  const ids = (entries as Record<string, unknown>)[membershipId];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && id.length > 0)) return [];
  return ids;
}

/** Undefined is the legacy all-register behavior; an empty list denies register operations. */
export function assignedRegisters(
  settings: Record<string, unknown>, membershipId: string,
): string[] | undefined {
  const entries = settings[MEMBER_REGISTERS_KEY];
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(entries, membershipId)) return undefined;
  const ids = (entries as Record<string, unknown>)[membershipId];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && id.length > 0)) return [];
  return ids;
}

export function deniedPermissions(
  settings: Record<string, unknown>,
  membershipId: string,
): string[] {
  const map = settings[MEMBER_DENIALS_KEY];
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const candidate = (map as Record<string, unknown>)[membershipId];
  if (!Array.isArray(candidate)) return [];
  return candidate.filter((value): value is string => typeof value === "string");
}

export function effectivePermissions(
  role: string,
  membershipId: string,
  settings: Record<string, unknown>,
): string[] {
  const baseline = ROLE_SEED[role as keyof typeof ROLE_SEED] ?? [];
  if (role === "owner") return [...baseline];
  const denied = new Set(deniedPermissions(settings, membershipId));
  return baseline.filter((permission) => !denied.has(permission));
}

export function visibleBusinessSettings(
  role: string,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  if (role === "owner") return settings;
  const visible = { ...settings };
  delete visible[MEMBER_DENIALS_KEY];
  delete visible[MEMBER_BRANCHES_KEY];
  delete visible[MEMBER_REGISTERS_KEY];
  return visible;
}
