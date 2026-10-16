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
    currentStep: "businessDetails",
    steps: {
      businessDetails: "pending",
      taxCurrency: "pending",
      receiptSetup: "pending",
      products: "pending",
      employees: "pending",
    },
  };
}

// A progress flag is not evidence that the business was configured.
// Reconcile legacy flags when loading a saved setup and at the session boundary.
export function isRequiredSetupConfigured(step: OnboardingStep, settings: Record<string, unknown>): boolean {
  switch (step) {
    case "businessDetails":
      return typeof settings["businessAddress"] === "string" &&
        settings["businessAddress"].trim().length >= 5 &&
        typeof settings["businessTimezone"] === "string" &&
        settings["businessTimezone"].trim().length >= 3;
    case "taxCurrency":
      return typeof settings["currency"] === "string" && settings["currency"].length === 3 &&
        typeof settings["taxName"] === "string" && settings["taxName"].trim().length > 0 &&
        typeof settings["taxRateBps"] === "number" &&
        Number.isInteger(settings["taxRateBps"]) &&
        settings["taxRateBps"] >= 0 && settings["taxRateBps"] <= 10000;
    case "receiptSetup":
      // The standard merchant-name receipt is available to every plan.
      // Custom headers are a separately entitled optional enhancement.
      return settings["standardReceiptConfirmed"] === true ||
        (typeof settings["receiptHeader"] === "string" &&
          settings["receiptHeader"].trim().length > 0);
    default:
      return true;
  }
}

export function configuredOnboardingState(settings: Record<string, unknown>): OnboardingState {
  const state = normalizeOnboardingState(settings["onboarding"]);
  // Existing businesses that finished the legacy wizard must not be
  // unexpectedly locked out during deployment. Any unfinished setup
  // still needs the new server-validated configuration.
  if (settings["onboardingSchemaVersion"] !== 2 &&
      REQUIRED_STEPS.every((step) => state.steps[step] === "done")) {
    return state;
  }
  const steps = { ...state.steps };
  for (const step of REQUIRED_STEPS) {
    if (steps[step] === "done" && !isRequiredSetupConfigured(step, settings)) {
      steps[step] = "pending";
    }
  }
  return { steps, currentStep: ONBOARDING_ORDER.find((step) => steps[step] === "pending") ?? "complete" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStepState(value: unknown): value is StepState {
  return value === "done" || value === "skipped" || value === "pending";
}

export function normalizeOnboardingState(value: unknown): OnboardingState {
  const fallback = defaultOnboardingState();
  if (!isRecord(value)) return fallback;

  const storedSteps = isRecord(value["steps"]) ? value["steps"] : {};
  const steps = Object.fromEntries(
    ONBOARDING_ORDER.map((step) => [
      step,
      isStepState(storedSteps[step]) && !(REQUIRED_STEPS.includes(step) && storedSteps[step] === "skipped")
        ? storedSteps[step]
        : fallback.steps[step],
    ]),
  ) as Record<OnboardingStep, StepState>;

  return {
    currentStep: ONBOARDING_ORDER.find((step) => steps[step] === "pending") ?? "complete",
    steps,
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
  const steps = normalizeOnboardingState(state).steps;
  return REQUIRED_STEPS.every((s) => steps[s] === "done");
}

export function mergeSettings(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, ...patch };
}
