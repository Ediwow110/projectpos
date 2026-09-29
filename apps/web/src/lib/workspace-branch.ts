export interface BranchScopedRegister {
  id: string;
  name: string;
  isActive: boolean;
  branchId: string | null;
}

export function registersForBranch<T extends BranchScopedRegister>(
  registers: T[],
  activeBranchId: string | null | undefined,
): T[] {
  const active = registers.filter((register) => register.isActive);
  if (!activeBranchId) return active;
  return active.filter((register) => register.branchId === activeBranchId);
}

export function branchScopeLabel(name: string | null | undefined): string {
  return name?.trim() ? name : "All branches";
}
