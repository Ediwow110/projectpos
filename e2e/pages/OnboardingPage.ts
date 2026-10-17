import { expect, type Page } from "@playwright/test";

export class OnboardingPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/onboarding");
  }

  async expectRequiredSetup(): Promise<void> {
    await expect(this.page).toHaveURL(/\/onboarding$/);
    await expect(this.page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
    await expect(this.page.getByText("Complete required setup to open the dashboard.")).toBeVisible();
    await expect(this.page.getByRole("link", { name: /Back to dashboard/i })).toHaveCount(0);
  }

  async saveBusinessDetails(): Promise<void> {
    await this.page.getByLabel("Business address").fill("123 QA Street, Manila");
    await this.page.getByRole("button", { name: "Save business details" }).click();
  }

  async saveTaxConfiguration(): Promise<void> {
    await this.page.getByLabel("Tax name").fill("No tax");
    await this.page.getByLabel("Tax rate (%)").fill("0");
    await this.page.getByRole("button", { name: "Save currency & tax" }).click();
  }

  async confirmReceiptSetup(): Promise<void> {
    await expect(this.page.getByText("Automatic receipt number", { exact: true })).toBeVisible();
    await this.page.getByLabel("I reviewed the receipt details for this business").check();
    await this.page.getByRole("button", { name: "Confirm receipt setup" }).click();
  }

  async skipOptionalStep(): Promise<void> {
    await this.page.getByRole("button", { name: "Skip for now" }).click();
  }
}
