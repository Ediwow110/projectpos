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
      await this.saveBusinessDetails();
    } else if (currentStep === "Currency & tax") {
      await this.saveTaxConfiguration();
    } else if (currentStep === "Receipt setup") {
      await this.confirmReceiptSetup();
    } else {
      throw new Error(`Unexpected required onboarding step: ${currentStep}`);
    }
    await expect(heading).not.toHaveText(currentStep);
  }

  async saveBusinessDetails(): Promise<void> {
    await this.page.getByLabel("Operating address").fill("123 QA Street, Manila");
    await this.page.getByRole("button", { name: "Save & continue" }).click();
  }

  async saveTaxConfiguration(): Promise<void> {
    await this.page.getByLabel(/Tax name/).fill("No tax");
    await this.page.getByLabel(/Tax rate/).fill("0");
    await this.page.getByRole("button", { name: "Save & continue" }).click();
  }

  async confirmReceiptSetup(): Promise<void> {
    await expect(this.page.getByText(/Automatic receipt number/)).toBeVisible();
    await this.page.getByRole("checkbox", { name: /I reviewed the receipt details/ }).check();
    await this.page.getByRole("button", { name: "Save & continue" }).click();
  }

  async skipOptionalStep(): Promise<void> {
    await this.page.getByRole("button", { name: "Skip for now" }).click();
  }
}
