export const ONBOARDING_ORDER = [
  "businessDetails",
  "taxCurrency",
  "receiptSetup",
  "products",
  "employees",
] as const;

export type OnboardingStep = (typeof ONBOARDING_ORDER)[number];
export type StepState = "done" | "skipped" | "pending";

export const REQUIRED_STEPS: readonly OnboardingStep[] = [
  "businessDetails",
  "taxCurrency",
  "receiptSetup",
];

export const SKIPPABLE_STEPS: readonly OnboardingStep[] = ["products", "employees"];

export interface OnboardingState {
  currentStep: string;
  steps: Record<OnboardingStep, StepState>;
}

export function defaultOnboardingState(): OnboardingState {
  return {
    currentStep: "taxCurrency",
    steps: {
      businessDetails: "done",
      taxCurrency: "pending",
      receiptSetup: "pending",
      products: "pending",
      employees: "pending",
    },
  };
}

export function applyOnboardingPatch(
  state: OnboardingState,
  patch: { step: OnboardingStep; state: "done" | "skipped" },
): OnboardingState {
  if (patch.state === "skipped" && !SKIPPABLE_STEPS.includes(patch.step)) {
    throw new Error("ONBOARDING_REQUIRED_STEP");
  }
  const steps = { ...state.steps, [patch.step]: patch.state };
  const next = ONBOARDING_ORDER.find((s) => steps[s] === "pending") ?? "complete";
  return { currentStep: next, steps };
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  return REQUIRED_STEPS.every((s) => state.steps[s] === "done");
}

export function mergeSettings(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, ...patch };
}
