import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
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
  useQuery: () => ({ data: fixture.data, isLoading: false, isError: false, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }),
}));

import OnboardingPage from "./page";

describe("onboarding navigation", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    fixture.data.currentStep = "receiptSetup";
    fixture.data.steps.businessDetails = "done";
    fixture.data.steps.taxCurrency = "pending";
    fixture.data.steps.receiptSetup = "pending";
    fixture.data.steps.products = "pending";
    fixture.data.steps.employees = "pending";
  });

  it("explains that mandatory setup must finish before the dashboard is available", () => {
    const html = renderToStaticMarkup(<OnboardingPage />);

    expect(html).not.toContain('href="/"');
    expect(html).toContain("Save your required business, tax and receipt settings to open the dashboard.");
    expect(html).toContain("Save &amp; continue");
    expect(html).toContain("Standard receipt included");
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
});
