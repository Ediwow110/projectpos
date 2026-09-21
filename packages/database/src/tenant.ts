export function requireTenant(businessId: string | null | undefined): string {
  if (!businessId || typeof businessId !== "string" || businessId.trim() === "") {
    throw new Error("TENANT_REQUIRED");
  }
  return businessId;
}

export function withScope<T extends object>(businessId: string, where: T): T & { businessId: string } {
  const valid = requireTenant(businessId);
  return { ...where, businessId: valid };
}
