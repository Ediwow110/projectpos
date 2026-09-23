const VOID_ROLES = new Set(["owner", "manager"]);

export function canVoidExpense(role: string): boolean {
  return VOID_ROLES.has(role);
}
