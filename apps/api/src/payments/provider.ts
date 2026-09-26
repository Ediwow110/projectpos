// Provider settlement adapters (Phase 10): query-only views over external
// payment providers. Adapters NEVER mutate sales or payments — a definitive
// answer informs the human-driven reconcile flow; anything else stays UNKNOWN
// per FR-PAY-04. Unknown methods, missing refs, and unknown providers return
// UNKNOWN rather than throwing: uncertainty must not become failure.

export type ProviderVerdict = "SUCCEEDED" | "FAILED" | "UNKNOWN";

export type ProviderName = "manual" | "test-double";

const ELECTRONIC_METHODS = new Set(["gcash", "maya", "card", "qrph"]);

// Scripted outcomes are keyed by tenant as well as provider reference: payment
// references are business-scoped, so one tenant's script must never settle
// another tenant's payment. A script without a businessId is rejected outright
// rather than applied globally.
const testDoubleOutcomes = new Map<string, ProviderVerdict>();

function outcomeKey(businessId: string | null, providerRef: string): string {
  return `${businessId}:${providerRef}`;
}

export function setTestDoubleOutcome(
  providerRef: string,
  outcome: ProviderVerdict,
  businessId: string,
): void {
  if (businessId.length === 0) throw new Error("VALIDATION");
  testDoubleOutcomes.set(outcomeKey(businessId, providerRef), outcome);
}

export function clearTestDoubleOutcomes(): void {
  testDoubleOutcomes.clear();
}

async function manualAdapter(): Promise<ProviderVerdict> {
  return "UNKNOWN";
}

async function testDoubleAdapter(providerRef: string, businessId: string | null): Promise<ProviderVerdict> {
  if (businessId === null) return "UNKNOWN";
  return testDoubleOutcomes.get(outcomeKey(businessId, providerRef)) ?? "UNKNOWN";
}

const ADAPTERS: Record<ProviderName, (providerRef: string, businessId: string | null) => Promise<ProviderVerdict>> = {
  manual: async () => manualAdapter(),
  "test-double": testDoubleAdapter,
};

export function resolveAdapter(name: string): ProviderName {
  return (name === "manual" || name === "test-double" ? name : "manual") as ProviderName;
}

export async function queryProviderStatus(
  method: string,
  providerRef: string | null,
  provider: string = "manual",
  businessId: string | null = null,
): Promise<ProviderVerdict> {
  if (!ELECTRONIC_METHODS.has(method)) return "UNKNOWN";
  if (!providerRef) return "UNKNOWN";
  return ADAPTERS[resolveAdapter(provider)](providerRef, businessId);
}
