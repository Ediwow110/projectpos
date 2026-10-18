import { expect, type Page } from "@playwright/test";

export class DashboardPage {
  constructor(private readonly page: Page) {}

  async expectEmptyState(): Promise<void> {
    await expect(this.page).toHaveURL(/\/$/);
    const overview = this.page.getByRole("region", { name: "Atlas owner overview" });
    await expect(overview.getByRole("heading", { name: "Owner overview", exact: true })).toBeVisible();
    const metrics = overview.locator('[aria-label="Owner report metrics"]');
    await expect(metrics).toContainText("Net sales in selected period");
    await expect(metrics).toContainText("₱0.00");
    await expect(metrics).toContainText("Sales in selected period");
    await expect(overview.getByText("No reported attention items in the selected business scope.")).toBeVisible();
    await expect(this.page.getByRole("link", { name: "Continue setup" })).toHaveCount(0);
  }
}
