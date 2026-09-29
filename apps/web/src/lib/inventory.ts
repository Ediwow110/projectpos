const ADJUST_ROLES = new Set(["owner", "manager", "inventory"]);

export function canAdjustInventory(role: string): boolean {
  return ADJUST_ROLES.has(role);
}

export function statusLabel(status: string): string {
  return status.toUpperCase();
}

export function buildBalancesSearch(params: {
  view?: string;
  page?: number;
  pageSize?: number;
  branchId?: string;
}): string {
  const sp = new URLSearchParams();
  sp.set("view", params.view ?? "all");
  sp.set("page", String(params.page ?? 1));
  sp.set("pageSize", String(params.pageSize ?? 20));
  if (params.branchId) sp.set("branchId", params.branchId);
  return `/api/v1/inventory/balances?${sp.toString()}`;
}
