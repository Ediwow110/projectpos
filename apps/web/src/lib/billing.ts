export function isPlanLimit(code: string): boolean {
  return code === "PLAN_LIMIT";
}

export function trialDaysLeft(trialEndsAt: string | null, nowMs = Date.now()): number | null {
  if (!trialEndsAt) return null;
  return Math.max(0, Math.ceil((Date.parse(trialEndsAt) - nowMs) / 86400000));
}

export function usagePct(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
}
