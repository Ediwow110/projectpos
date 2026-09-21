export function buildProductSearch(params: {
  q?: string;
  categoryId?: string;
  active?: string;
  page?: number;
  pageSize?: number;
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.categoryId) sp.set("categoryId", params.categoryId);
  sp.set("page", String(params.page ?? 1));
  sp.set("pageSize", String(params.pageSize ?? 20));
  if (params.active) sp.set("active", params.active);
  return `/api/v1/products?${sp.toString()}`;
}

const EDIT_ROLES = new Set(["owner", "manager", "inventory"]);

export function canEditCatalog(role: string): boolean {
  return EDIT_ROLES.has(role);
}

export function canSeeCost(role: string): boolean {
  return EDIT_ROLES.has(role);
}
