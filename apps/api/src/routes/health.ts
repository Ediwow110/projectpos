export function health(ctx: { businessId: string }, requestId: string): { ok: boolean; requestId: string; timestamp: string } {
  if (!ctx.businessId) throw new Error("TENANT_REQUIRED");
  return { ok: true, requestId, timestamp: new Date().toISOString() };
}
