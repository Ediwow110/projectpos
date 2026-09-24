// Provider settlement adapters (Phase 10): query-only views over external
// payment providers. Adapters NEVER mutate sales or payments — a definitive
// answer informs the human-driven reconcile flow; anything else stays UNKNOWN
// per FR-PAY-04. Unknown methods, missing refs, and unknown providers return
// UNKNOWN rather than throwing: uncertainty must not become failure.

export type ProviderVerdict = "SUCCEEDED" | "FAILED" | "UNKNOWN";

export type ProviderName = "manual" | "test-double";

const ELECTRONIC_METHODS = new Set(["gcash", "maya", "card"]);

const testDoubleOutcomes = new Map<string, ProviderVerdict>();

export function setTestDoubleOutcome(providerRef: string, outcome: ProviderVerdict): void {
  testDoubleOutcomes.set(providerRef, outcome);
}

export function clearTestDoubleOutcomes(): void {
  testDoubleOutcomes.clear();
}

async function manualAdapter(): Promise<ProviderVerdict> {
  return "UNKNOWN";
}

async function testDoubleAdapter(providerRef: string): Promise<ProviderVerdict> {
  return testDoubleOutcomes.get(providerRef) ?? "UNKNOWN";
}

const ADAPTERS: Record<ProviderName, (providerRef: string) => Promise<ProviderVerdict>> = {
  manual: manualAdapter,
  "test-double": testDoubleAdapter,
};

export function resolveAdapter(name: string): ProviderName {
  return (name === "manual" || name === "test-double" ? name : "manual") as ProviderName;
}

export async function queryProviderStatus(
  method: string,
  providerRef: string | null,
  provider: string = "manual",
): Promise<ProviderVerdict> {
  if (!ELECTRONIC_METHODS.has(method)) return "UNKNOWN";
  if (!providerRef) return "UNKNOWN";
  return ADAPTERS[resolveAdapter(provider)](providerRef);
}
