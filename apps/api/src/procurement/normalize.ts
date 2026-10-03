import type { SupplierCreateInput, SupplierUpdateInput } from "@pos/validation";

export function normalizeSupplierCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code ? code : null;
}

function optionalText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

export function normalizeSupplierPayload(
  input: SupplierCreateInput | SupplierUpdateInput,
): Record<string, string | null> {
  return {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.code !== undefined ? { code: normalizeSupplierCode(input.code) } : {}),
    ...(input.contactName !== undefined ? { contactName: optionalText(input.contactName) } : {}),
    ...(input.email !== undefined ? { email: optionalText(input.email)?.toLowerCase() ?? null } : {}),
    ...(input.phone !== undefined ? { phone: optionalText(input.phone) } : {}),
    ...(input.addressLine1 !== undefined ? { addressLine1: optionalText(input.addressLine1) } : {}),
    ...(input.addressLine2 !== undefined ? { addressLine2: optionalText(input.addressLine2) } : {}),
    ...(input.city !== undefined ? { city: optionalText(input.city) } : {}),
    ...(input.province !== undefined ? { province: optionalText(input.province) } : {}),
    ...(input.postalCode !== undefined ? { postalCode: optionalText(input.postalCode) } : {}),
    ...(input.country !== undefined ? { country: input.country.trim().toUpperCase() } : {}),
    ...(input.paymentTerms !== undefined ? { paymentTerms: optionalText(input.paymentTerms) } : {}),
    ...(input.notes !== undefined ? { notes: optionalText(input.notes) } : {}),
  };
}

export function parseExpectedDate(value: string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("VALIDATION");
  const now = Date.now();
  const day = 86_400_000;
  if (date.getTime() < now - 365 * day || date.getTime() > now + 365 * day) throw new Error("VALIDATION");
  return date;
}

export function parsePurchaseOrderFilterDate(value: string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("VALIDATION");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("VALIDATION");
  return date;
}
