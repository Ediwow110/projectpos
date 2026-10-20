import { describe, expect, it } from "vitest";
import {
  applyOnboardingPatch,
  configuredOnboardingState,
  defaultOnboardingState,
  isOnboardingComplete,
  mergeSettings,
  normalizeOnboardingState,
} from "../src/business/onboarding";

describe("onboarding wizard", () => {
  it("starts with businessDetails pending until the owner saves an operating profile", () => {
    expect(defaultOnboardingState().steps.businessDetails).toBe("pending");
  });
  it("advances current step on done", () => {
    const profileDone = applyOnboardingPatch(defaultOnboardingState(), { step: "businessDetails", state: "done" });
    const next = applyOnboardingPatch(profileDone, {
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
    for (const step of ["businessDetails", "taxCurrency", "receiptSetup"] as const) {
      s = applyOnboardingPatch(s, { step, state: "done" });
    }
    s = applyOnboardingPatch(s, { step: "products", state: "skipped" });
    s = applyOnboardingPatch(s, { step: "employees", state: "skipped" });
    expect(isOnboardingComplete(s)).toBe(true);
  });
  it("repairs a stored required step marked skipped and does not unlock the workspace", () => {
    const state = normalizeOnboardingState({
      currentStep: "complete",
      steps: {
        businessDetails: "done",
        taxCurrency: "skipped",
        receiptSetup: "done",
        products: "skipped",
        employees: "skipped",
      },
    });
    expect(state.currentStep).toBe("taxCurrency");
    expect(state.steps.taxCurrency).toBe("pending");
    expect(isOnboardingComplete(state)).toBe(false);
  });
  it("keeps setup required when optional products resolve before currency and receipt", () => {
    let state = applyOnboardingPatch(defaultOnboardingState(), { step: "products", state: "skipped" });
    expect(state.currentStep).toBe("businessDetails");
    expect(isOnboardingComplete(state)).toBe(false);
    state = applyOnboardingPatch(state, { step: "taxCurrency", state: "done" });
    expect(state.currentStep).toBe("businessDetails");
    expect(isOnboardingComplete(state)).toBe(false);
  });
  it("merges settings without dropping existing keys", () => {
    expect(mergeSettings({ currency: "PHP" }, { taxName: "VAT" })).toEqual({
      currency: "PHP",
      taxName: "VAT",
    });
  });
  it("reopens a completed setup step when required stored data is missing", () => {
    const state = {
      onboardingSchemaVersion: 2,
      onboarding: {
        currentStep: "complete",
        steps: {
          businessDetails: "done",
          taxCurrency: "done",
          receiptSetup: "done",
          products: "skipped",
          employees: "skipped",
        },
      },
      currency: "PHP",
      businessAddress: "123 Market Street",
      businessTimezone: "Asia/Manila",
      taxName: "No tax",
      taxRateBps: 0,
    };
    const result = configuredOnboardingState(state);
    expect(result.steps.receiptSetup).toBe("pending");
    expect(result.currentStep).toBe("receiptSetup");
    expect(isOnboardingComplete(result)).toBe(false);
    expect(configuredOnboardingState({ ...state, standardReceiptConfirmed: true }).currentStep).toBe("complete");
  });
  it("preserves access for already-completed legacy accounts during rollout", () => {
    const original = defaultOnboardingState();
    for (const step of ["businessDetails", "taxCurrency", "receiptSetup"] as const) {
      original.steps[step] = "done";
    }
    expect(configuredOnboardingState({ onboarding: original }).currentStep).toBe("products");
    expect(isOnboardingComplete(configuredOnboardingState({ onboarding: original }))).toBe(true);
  });
});
