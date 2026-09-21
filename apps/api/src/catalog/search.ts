export interface CatalogRow {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: string | null;
  costMinor: number;
  priceMinor: number;
  isActive: boolean;
  [key: string]: unknown;
}

export function matchesQuery(row: CatalogRow, q: string): boolean {
  const needle = q.trim();
  if (needle === "") return true;
  if (row.name.toLowerCase().includes(needle.toLowerCase())) return true;
  if (row.sku && row.sku.toLowerCase().includes(needle.toLowerCase())) return true;
  if (row.barcode && row.barcode === needle) return true;
  return false;
}

export function applyProductSearch<T extends CatalogRow>(
  rows: T[],
  opts: { q?: string; categoryId?: string; active: "true" | "false" | "all"; page: number; pageSize: number },
): { items: T[]; total: number; page: number; pageSize: number } {
  let out = rows.filter((r) => {
    if (opts.active === "true" && !r.isActive) return false;
    if (opts.active === "false" && r.isActive) return false;
    if (opts.categoryId && r.categoryId !== opts.categoryId) return false;
    if (opts.q && !matchesQuery(r, opts.q)) return false;
    return true;
  });
  out = [...out].sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  const total = out.length;
  const start = (opts.page - 1) * opts.pageSize;
  return { items: out.slice(start, start + opts.pageSize), total, page: opts.page, pageSize: opts.pageSize };
}

export function redactProductForRole<T extends { costMinor: number }>(
  row: T,
  granted: string[],
): Omit<T, "costMinor"> | T {
  if (granted.includes("cost.view")) return row;
  const { costMinor: _omitted, ...rest } = row;
  void _omitted;
  return rest;
}
