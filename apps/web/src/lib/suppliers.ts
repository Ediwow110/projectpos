import { formatPesoMinor } from "./money";

export interface Supplier {
  id: string;
  name: string;
  code: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  paymentTerms: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSupplier {
  id: string;
  productId: string;
  supplierId: string;
  supplierSku: string | null;
  unitCostMinor: number | null;
  leadTimeDays: number | null;
  isPreferred: boolean;
}

export function suppliersPath(opts: { q?: string; status?: string; page?: number; pageSize?: number } = {}): string {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.status) params.set("status", opts.status);
  if (opts.page) params.set("page", String(opts.page));
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
  const query = params.toString();
  return `/api/v1/suppliers${query ? `?${query}` : ""}`;
}

export function supplierStatusLabel(active: boolean): string {
  return active ? "Active" : "Inactive";
}

export function formatMinor(minor: number | null | undefined): string {
  return formatPesoMinor(minor ?? 0);
}

export function requestKey(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
