const MANAGE_ROLES = new Set(["owner", "manager"]);

export function canManageCustomers(role: string): boolean {
  return MANAGE_ROLES.has(role);
}

export function customerLabel(c: { name: string; phone: string | null }): string {
  return c.phone ? `${c.name} — ${c.phone}` : c.name;
}
