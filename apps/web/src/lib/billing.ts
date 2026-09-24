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

export interface PlanLimitNotice {
  plan: string;
  limit: string | null;
  used: string | null;
  resource: string;
  message: string;
}

const RESOURCE_LABELS: Record<string, string> = {
  users: "User",
  products: "Product",
  registers: "Register",
  branches: "Branch",
  reports: "Reports",
  customers: "Customers",
  expenses: "Expenses",
  advanced_reports: "Advanced reports",
  receipt_customization: "Receipt customization",
  api: "Public API",
  exports: "Exports",
  printers: "Receipt printers",
  display: "Customer display",
};

function label(resource: string): string {
  const known = RESOURCE_LABELS[resource];
  if (known) return known;
  const spaced = resource.replace(/[._]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function planLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

// Turns a 402 PLAN_LIMIT envelope into copy an owner can act on, so every
// capped surface can offer the /billing upgrade path instead of a bare code.
export function planLimitNotice(error: unknown): PlanLimitNotice | null {
  const err = error as { code?: unknown; fields?: Record<string, string[]> } | null;
  if (!err || err.code !== "PLAN_LIMIT") return null;
  const fields = err.fields ?? {};
  const one = (key: string): string | null => {
    const value = fields[key];
    return Array.isArray(value) && value.length > 0 ? String(value[0]) : null;
  };
  const plan = one("plan") ?? "current";
  const limit = one("limit");
  const used = one("used");
  const feature = one("feature");
  const resource = feature ?? one("resource") ?? "usage";
  const name = label(resource);
  const message = limit !== null && used !== null
    ? `${name} limit reached on the ${planLabel(plan)} plan (${used} of ${limit} used).`
    : `${name} is not included in the ${planLabel(plan)} plan.`;
  return { plan, limit, used, resource, message };
}

// Shared error copy: plan-limit breaches read as upgrade guidance, everything
// else keeps the stable code:message envelope the API returned.
export function errorText(error: unknown, fallback: string): string {
  const notice = planLimitNotice(error);
  if (notice) return notice.message;
  const err = error as { code?: unknown; message?: unknown } | null;
  if (err && typeof err.code === "string" && typeof err.message === "string") {
    return `${err.code}: ${err.message}`;
  }
  return fallback;
}
