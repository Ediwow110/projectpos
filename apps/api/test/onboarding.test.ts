import { describe, expect, it } from "vitest";
import {
  applyOnboardingPatch,
  defaultOnboardingState,
  isOnboardingComplete,
  mergeSettings,
} from "../src/business/onboarding";

describe("onboarding wizard", () => {
  it("starts with businessDetails done", () => {
    expect(defaultOnboardingState().steps.businessDetails).toBe("done");
  });
  it("advances current step on done", () => {
    const next = applyOnboardingPatch(defaultOnboardingState(), {
      step: "taxCurrency",
      state: "done",
    });
    expect(next.steps.taxCurrency).toBe("done");
    expect(next.currentStep).toBe("receiptSetup");
  });
  it("allows skipping products and employees only", () => {
    const s = defaultOnboardingState();
    expect(() =>
      applyOnboardingPatch(s, { step: "taxCurrency", state: "skipped" }),
    ).toThrow("ONBOARDING_REQUIRED_STEP");
    expect(() =>
      applyOnboardingPatch(s, { step: "products", state: "skipped" }),
    ).not.toThrow();
  });
  it("completes when required done and optional resolved", () => {
    let s = defaultOnboardingState();
    for (const step of ["taxCurrency", "receiptSetup"] as const) {
      s = applyOnboardingPatch(s, { step, state: "done" });
    }
    s = applyOnboardingPatch(s, { step: "products", state: "skipped" });
    s = applyOnboardingPatch(s, { step: "employees", state: "skipped" });
    expect(isOnboardingComplete(s)).toBe(true);
  });
  it("merges settings without dropping existing keys", () => {
    expect(mergeSettings({ currency: "PHP" }, { taxName: "VAT" })).toEqual({
      currency: "PHP",
      taxName: "VAT",
    });
  });
});
