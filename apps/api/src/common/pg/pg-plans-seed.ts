// The four plan rows every boot and test harness expects. Same JSON as the
// migration 0011 seeds: the migration owns the database, this file owns the
// runtime contract (the memory factory seeds the same rows).
export interface PlanSeed {
  id: string;
  key: "free" | "basic" | "pro" | "enterprise";
  name: string;
  allowances: Record<string, unknown>;
  pricesMinor: { monthlyMinor: number };
}

export const PLAN_SEEDS: PlanSeed[] = [
  {
    id: "plan_free", key: "free", name: "Free",
    allowances: { users: 3, products: 100, registers: 1, branches: 0, features: [] },
    pricesMinor: { monthlyMinor: 0 },
  },
  {
    id: "plan_basic", key: "basic", name: "Basic",
    allowances: {
      users: 10, products: 2000, registers: 3, branches: 0,
      features: ["reports", "customers", "receipt_customization"],
    },
    pricesMinor: { monthlyMinor: 49000 },
  },
  {
    id: "plan_pro", key: "pro", name: "Pro",
    allowances: {
      users: 50, products: 20000, registers: 10, branches: 0,
      features: [
        "reports", "customers", "receipt_customization", "advanced_reports",
        "employee_permissions", "expenses", "advanced_analytics",
      ],
    },
    pricesMinor: { monthlyMinor: 149000 },
  },
  {
    id: "plan_enterprise", key: "enterprise", name: "Enterprise",
    allowances: {
      users: null, products: null, registers: null, branches: null,
      features: [
        "reports", "customers", "receipt_customization", "advanced_reports",
        "employee_permissions", "expenses", "advanced_analytics", "branches",
        "central_management", "api", "advanced_permissions", "integrations",
      ],
    },
    pricesMinor: { monthlyMinor: 0 },
  },
];
