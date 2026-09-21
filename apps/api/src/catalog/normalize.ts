export interface NormalizedProductInput {
  name: string;
  sku: string | null;
  barcode: string | null;
}

export function normalizeSku(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = raw.trim().toUpperCase();
  return v === "" ? null : v;
}

export function normalizeBarcode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = raw.trim();
  return v === "" ? null : v;
}

export function normalizeProductInput(input: {
  name: string;
  sku?: string | null;
  barcode?: string | null;
}): NormalizedProductInput {
  return {
    name: input.name.trim(),
    sku: normalizeSku(input.sku ?? null),
    barcode: normalizeBarcode(input.barcode ?? null),
  };
}

export function findDuplicateSku(items: Array<{ sku?: string | null }>): number {
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    const sku = normalizeSku(items[i].sku ?? null);
    if (!sku) continue;
    if (seen.has(sku)) return i;
    seen.add(sku);
  }
  return -1;
}

export function findDuplicateBarcode(items: Array<{ barcode?: string | null }>): number {
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    const bc = normalizeBarcode(items[i].barcode ?? null);
    if (!bc) continue;
    if (seen.has(bc)) return i;
    seen.add(bc);
  }
  return -1;
}
