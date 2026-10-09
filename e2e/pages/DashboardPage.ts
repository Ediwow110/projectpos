import { expect, type Page } from "@playwright/test";

export class DashboardPage {
  constructor(private readonly page: Page) {}

  async expectEmptyState(): Promise<void> {
    await expect(this.page).toHaveURL(/\/$/);
    await expect(this.page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(this.page.getByText("Getting started", { exact: true })).toBeVisible();
    await expect(this.page.getByRole("link", { name: "Continue setup" })).toHaveCount(0);
  }
}
