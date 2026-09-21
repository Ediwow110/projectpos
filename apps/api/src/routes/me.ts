export interface MeContext {
  businessId: string;
  userId: string;
}

export function me(ctx: MeContext, requestId: string): MeContext & { requestId: string; timestamp: string } {
  if (!ctx.businessId) throw new Error("TENANT_REQUIRED");
  return { ...ctx, requestId, timestamp: new Date().toISOString() };
}
