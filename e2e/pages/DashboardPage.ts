import { expect, type Page } from "@playwright/test";

export class DashboardPage {
  constructor(private readonly page: Page) {}

  async expectEmptyState(): Promise<void> {
    await expect(this.page).toHaveURL(/\/$/);
    const ownerOverview = this.page.getByRole("region", { name: "Atlas owner overview" });
    await expect(ownerOverview.getByRole("heading", { name: "Owner overview", exact: true })).toBeVisible();
    await expect(ownerOverview.getByText("Sales in selected period", { exact: true })).toBeVisible();
    await expect(this.page.getByRole("link", { name: "Continue setup" })).toHaveCount(0);
  }
}
