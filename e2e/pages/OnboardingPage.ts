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

  async completeCurrentStep(): Promise<void> {
    await this.page.getByRole("button", { name: "Mark step complete" }).click();
  }

  async skipOptionalStep(): Promise<void> {
    await this.page.getByRole("button", { name: "Skip for now" }).click();
  }
}
