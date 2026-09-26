export interface PlanAllowances {
  users: number | null;
  products: number | null;
  registers: number | null;
  branches: number | null;
  features: string[];
}

export const PLAN_ALLOWANCES: Record<string, PlanAllowances> = {
  free: { users: 3, products: 100, registers: 1, branches: 0, features: [] },
  basic: { users: 10, products: 2000, registers: 3, branches: 0, features: ["reports", "customers", "receipt_customization"] },
  pro: { users: 50, products: 20000, registers: 10, branches: 0, features: ["reports", "customers", "receipt_customization", "advanced_reports", "employee_permissions", "expenses", "advanced_analytics"] },
  enterprise: { users: null, products: null, registers: null, branches: null, features: ["reports", "customers", "receipt_customization", "advanced_reports", "employee_permissions", "expenses", "advanced_analytics", "branches", "central_management", "api", "advanced_permissions", "integrations"] },
};

export const ENTERPRISE: PlanAllowances = PLAN_ALLOWANCES["enterprise"]!;

export function billingEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  if ((source["NODE_ENV"] ?? "development") === "test") return true;
  return source["BILLING_ENABLED"] === "1";
}

export function isTrialExpired(status: string, trialEndsAt: Date | null, now: Date): boolean {
  return status === "trialing" && trialEndsAt !== null && trialEndsAt.getTime() <= now.getTime();
}

// Provider spellings differ ("cancelled" vs "canceled"); the store keeps one
// canonical value so status comparisons never miss a cancellation.
export function normalizeSubscriptionStatus(status: string): string {
  return status === "cancelled" ? "canceled" : status;
}

export function monthPeriod(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
