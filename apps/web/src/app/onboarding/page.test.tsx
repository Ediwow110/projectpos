import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  legacyReviewSteps: [] as string[],
  readiness: {} as Record<string, unknown>,
  settings: {} as Record<string, unknown>,
  readinessError: false,
  role: "owner",
  permissions: ["settings.write"] as string[] | undefined,
  sessionError: false,
  onboardingError: false,
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
    data: queryKey[0] === "me"
      ? (fixture.sessionError ? undefined : { role: fixture.role, permissions: fixture.permissions })
      : queryKey[0] === "onboarding-sale-readiness"
      ? (fixture.readinessError ? undefined : {
          businessConfigured: true,
          legacySetupReviewSteps: fixture.legacyReviewSteps,
          hasSellableProduct: false,
          hasActiveRegister: false,
          hasOpenShift: false,
          hasStaff: false,
          canCustomizeReceipt: false,
          readyForFirstSale: false,
          missing: [],
          ...fixture.readiness,
        })
      : queryKey[0] === "onboarding-business"
        ? { name: "QA Business", currency: "PHP", settings: fixture.settings }
        : queryKey[0] === "onboarding" && fixture.onboardingError
          ? undefined
          : fixture.data,
    isLoading: false,
    isError: queryKey[0] === "onboarding-sale-readiness"
      ? fixture.readinessError
      : queryKey[0] === "me" && fixture.sessionError
        || queryKey[0] === "onboarding" && fixture.onboardingError,
    refetch: vi.fn(),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }),
}));

import OnboardingPage from "./page";

describe("onboarding navigation", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    fixture.legacyReviewSteps = [];
    fixture.readiness = {};
    fixture.settings = {};
    fixture.readinessError = false;
    fixture.role = "owner";
    fixture.permissions = ["settings.write"];
    fixture.sessionError = false;
    fixture.onboardingError = false;
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

  it("keeps the dashboard reachable from the setup brand and the review footer", () => {
    fixture.data.currentStep = "complete";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";
    fixture.data.steps.products = "skipped";
    fixture.data.steps.employees = "skipped";

    const html = renderToStaticMarkup(<OnboardingPage />);
    const brand = html.match(/<a[^>]*aria-label="NexPOS home"[^>]*>/)?.[0] ?? "";

    expect(html.match(/href="\/"/g) ?? []).toHaveLength(2);
    expect(brand).toContain('href="/"');
    expect(html).toContain("← Back to dashboard");
  });

  it("keeps the setup brand on the sign-in entry while required setup is incomplete", () => {
    const html = renderToStaticMarkup(<OnboardingPage />);
    const brand = html.match(/<a[^>]*aria-label="NexPOS home"[^>]*>/)?.[0] ?? "";

    expect(brand).toContain('href="/login"');
    expect(html).not.toContain("← Back to dashboard");
  });

  it("renders the first-sale checklist from the shared readiness contract", () => {
    fixture.data.currentStep = "complete";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";
    fixture.data.steps.products = "skipped";
    fixture.data.steps.employees = "skipped";

    const html = renderToStaticMarkup(<OnboardingPage />);

    // The onboarding checklist and the owner overview checklist must come from
    // one contract, so the labels and destinations cannot drift apart.
    expect(html).toContain("Sellable product with available stock");
    expect(html).toContain('href="/products"');
    expect(html).toContain('href="/registers"');
    expect(html).toContain('href="/shifts"');
    expect(html).not.toContain("At least one sellable product with available stock (if tracked)");
  });

  it("does not show a stale instruction on a step that is already complete", () => {
    fixture.data.currentStep = "complete";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";
    fixture.data.steps.products = "skipped";
    fixture.data.steps.employees = "skipped";

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).not.toContain("Save your operating address, optional phone and timezone before continuing.");
    expect(html).toContain("This step is complete");
  });

  it("states that the setup review status is unavailable when readiness cannot be read", () => {
    fixture.data.currentStep = "complete";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";
    fixture.data.steps.products = "skipped";
    fixture.data.steps.employees = "skipped";
    fixture.readinessError = true;

    const html = renderToStaticMarkup(<OnboardingPage />);

    // The step flag itself genuinely says "done" (GET /api/v1/onboarding
    // succeeded), so it is not suppressed; what must not happen is the owner
    // believing the setup was cross-checked. The unavailable status is stated.
    expect(html).toContain("Setup review status is unavailable");
    expect(html).toContain("Could not load sale readiness");
  });

  it("ignores an unrecognised legacy review step instead of blanking setup", () => {
    fixture.data.currentStep = "complete";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";
    fixture.data.steps.products = "skipped";
    fixture.data.steps.employees = "skipped";
    fixture.legacyReviewSteps = ["bogus"];

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain("Set up your business");
    expect(html).toContain("Business details");
  });

  it("tolerates a non-array legacy review payload", () => {
    fixture.data.currentStep = "complete";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";
    fixture.data.steps.products = "skipped";
    fixture.data.steps.employees = "skipped";
    fixture.legacyReviewSteps = "businessDetails" as unknown as string[];

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain("Set up your business");
  });

  it("shows an outstanding server readiness gap even when all three visible checks pass", () => {
    fixture.data.currentStep = "complete";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "done";
    fixture.data.steps.receiptSetup = "done";
    fixture.data.steps.products = "skipped";
    fixture.data.steps.employees = "skipped";
    fixture.readiness = {
      hasSellableProduct: true,
      hasActiveRegister: true,
      hasOpenShift: true,
      readyForFirstSale: false,
      missing: ["stock_at_open_register"],
    };

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html.match(/✓/g) ?? []).toHaveLength(3);
    expect(html).toContain("No stock is available at the open register.");
    expect(html).toContain("Not ready for first sale");
  });

  it("refuses business-settings editing for a session without settings.write", () => {
    fixture.role = "manager";
    fixture.permissions = ["sale.create", "gift_card.manage"];
    fixture.data.currentStep = "taxCurrency";

    const html = renderToStaticMarkup(<OnboardingPage />);

    // The owner-only editor must not be offered to a manager, even though the
    // server answers GET /api/v1/onboarding with 200 for every member.
    expect(html).toContain("You do not have access to business setup");
    expect(html).not.toContain("Save &amp; continue");
    expect(html).not.toContain("Tax rate (%)");
  });

  it("refuses business-settings editing when the server sent no permission list", () => {
    fixture.role = "cashier";
    fixture.permissions = undefined;
    fixture.data.currentStep = "taxCurrency";

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain("You do not have access to business setup");
    expect(html).not.toContain("Save &amp; continue");
  });

  it("keeps the owner editor available to a session that holds settings.write", () => {
    fixture.role = "owner";
    fixture.permissions = ["settings.write"];
    fixture.data.currentStep = "taxCurrency";

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain("Save &amp; continue");
    expect(html).not.toContain("You do not have access to business setup");
  });

  it("states that setup progress could not be loaded before anything about permissions", () => {
    // The page's own data is the primary problem, so a broken setup read must
    // not be reported as a permission problem.
    fixture.onboardingError = true;
    fixture.sessionError = true;

    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).toContain("Could not load setup progress.");
    expect(html).not.toContain("Could not verify your access to business setup");
    expect(html).not.toContain("You do not have access to business setup");
  });

  it("states that it could not verify the session when the session read failed", () => {
    fixture.sessionError = true;
    fixture.data.currentStep = "taxCurrency";

    const html = renderToStaticMarkup(<OnboardingPage />);

    // A session that could not be read must not be told it lacks permission,
    // and must not be shown the owner editor either.
    expect(html).toContain("Could not verify your access to business setup");
    expect(html).not.toContain("You do not have access to business setup");
    expect(html).not.toContain("Save &amp; continue");
  });
});
