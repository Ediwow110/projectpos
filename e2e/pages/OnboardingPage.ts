import { expect, type Page } from "@playwright/test";

export class OnboardingPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/onboarding");
  }

  async expectRequiredSetup(): Promise<void> {
    await expect(this.page).toHaveURL(/\/onboarding$/);
    await expect(this.page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
    await expect(this.page.getByText("Save your required business, tax and receipt settings to open the dashboard.")).toBeVisible();
    await expect(this.page.getByRole("link", { name: /Back to dashboard/i })).toHaveCount(0);
  }

  async completeCurrentStep(): Promise<void> {
    const heading = this.page.getByRole("heading", { level: 2 }).first();
    await expect(heading).toBeVisible();
    const currentStep = (await heading.innerText()).trim();
    if (currentStep === "Business details") {
      await this.page.getByLabel("Operating address").fill("123 Test Street, Manila");
    } else if (currentStep === "Currency & tax") {
      await this.page.getByLabel("Tax name (e.g. VAT, non-VAT, no tax)").fill("No tax");
      await this.page.getByLabel(/Tax rate/).fill("0");
    } else if (currentStep === "Receipt setup") {
      await expect(this.page.getByText(/Standard receipt included/)).toBeVisible();
    } else {
      throw new Error(`Unexpected required onboarding step: ${currentStep}`);
    }
    await this.page.getByRole("button", { name: "Save & continue" }).click();
    await expect(heading).not.toHaveText(currentStep);
  }

  async skipOptionalStep(): Promise<void> {
    await this.page.getByRole("button", { name: "Skip for now" }).click();
  }
}
