import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  legacyReviewSteps: [] as string[],
  settings: {} as Record<string, unknown>,
  data: {
    currentStep: "receiptSetup",
    steps: {
      businessDetails: "done",
      taxCurrency: "done",
      receiptSetup: "pending",
      products: "pending",
      employees: "pending",
    },
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "onboarding-sale-readiness"
      ? { legacySetupReviewSteps: fixture.legacyReviewSteps, canCustomizeReceipt: false }
      : queryKey[0] === "onboarding-business"
        ? { name: "QA Business", currency: "PHP", settings: fixture.settings }
        : fixture.data,
    isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }),
}));

import OnboardingPage from "./page";

describe("onboarding navigation", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    fixture.legacyReviewSteps = [];
    fixture.settings = {};
    fixture.data.currentStep = "receiptSetup";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "pending";
    fixture.data.steps.receiptSetup = "pending";
    fixture.data.steps.products = "pending";
    fixture.data.steps.employees = "pending";
  });

  it("opens the first missing saved legacy step for review despite historic done flags", () => {
    fixture.data.currentStep = "complete";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";
    fixture.data.steps.products = "skipped";
    fixture.data.steps.employees = "skipped";
    fixture.legacyReviewSteps = ["businessDetails", "taxCurrency", "receiptSetup"];

    const html = renderToStaticMarkup(<OnboardingPage />);
    expect(html).toContain("Earlier setup was marked done without saving 3 required steps");
    expect(html).toContain("Review required · Missing saved settings");
    expect(html).toContain("Operating address");
    expect(html).toContain("Save &amp; continue");
  });

  it("explains that mandatory setup must finish before the dashboard is available", () => {
    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).not.toContain('href="/"');
    expect(html).toContain("Save your required business, tax and receipt settings to open the dashboard.");
    expect(html).toContain("Save &amp; continue");
    expect(html).toContain("Standard receipt included");
    expect(html).not.toContain("Mark step complete");
  });

  it("asks the owner to save real tax settings instead of marking the step complete", () => {
    fixture.data.currentStep = "taxCurrency";
    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain("Tax name");
    expect(html).toContain("Tax rate (%)");
    expect(html).toContain("Currency");
    expect(html).toContain("Save &amp; continue");
    expect(html).not.toContain("Mark step complete");
  });

  it("collects real business contact details before the owner completes business setup", () => {
    fixture.data.currentStep = "businessDetails";
    fixture.data.steps.businessDetails = "pending";
    const html = renderToStaticMarkup(<OnboardingPage />);
    expect(html).toContain("Operating address");
    expect(html).toContain("Business phone (optional)");
    expect(html).toContain("Operating timezone");
    expect(html).toContain("Save &amp; continue");
    expect(html).not.toContain("Mark step complete");
  });

  it("requires owner confirmation of receipt output instead of a blind step completion", () => {
    fixture.data.currentStep = "receiptSetup";
    fixture.data.steps.taxCurrency = "done";
    const html = renderToStaticMarkup(<OnboardingPage />);
    expect(html).toContain("Receipt preview");
    expect(html).toContain("Automatic receipt number");
    expect(html).toContain("I reviewed the receipt details");
    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain("Save &amp; continue");
    expect(html).not.toContain("Mark step complete");
  });

  it("lets owners go to the dashboard when only optional setup steps remain", () => {
    fixture.data.currentStep = "products";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain('href="/"');
    expect(html).toContain("← Back to dashboard");
    expect(html).not.toContain("Complete required setup to open the dashboard.");
  });

  it("lands a completed owner on the first required step and shows the saved business settings", () => {
    fixture.data.currentStep = "complete";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";
    fixture.data.steps.products = "skipped";
    fixture.data.steps.employees = "skipped";
    fixture.settings = {
      businessAddress: "123 Rizal St, Manila",
      businessPhone: "09171234567",
      businessTimezone: "Asia/Manila",
      taxName: "no tax",
      taxRateBps: 0,
      standardReceiptConfirmed: true,
    };

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain('aria-label="Saved business settings"');
    expect(html).toContain("123 Rizal St, Manila");
    expect(html).toContain("Asia/Manila");
    expect(html).toContain("PHP");
    expect(html).toContain("no tax");
    expect(html).toContain("0%");
    expect(html).toContain("Standard receipt confirmed");
    expect(html).toContain("This step is complete");
    expect(html).not.toContain("Owner-only stores can skip employee setup.");
  });

  it("keeps a single dashboard link when a completed owner reviews saved settings", () => {
    fixture.data.currentStep = "complete";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";
    fixture.data.steps.products = "skipped";
    fixture.data.steps.employees = "skipped";

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html.match(/href="\/"/g) ?? []).toHaveLength(1);
    expect(html).toContain("← Back to dashboard");
  });
});
