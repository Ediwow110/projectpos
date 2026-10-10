import { minorToMajorFixed } from "./money";

export function money(minor: number): string {
  return minorToMajorFixed(minor);
}

const MANAGE_ROLES = new Set(["owner", "manager"]);

export function canManageRegisters(role: string): boolean {
  return MANAGE_ROLES.has(role);
}

export function varianceLabel(varianceMinor: number): string {
  if (varianceMinor === 0) return "BALANCED";
  if (varianceMinor > 0) return `OVER ${money(varianceMinor)}`;
  return `SHORT ${money(-varianceMinor)}`;
}
