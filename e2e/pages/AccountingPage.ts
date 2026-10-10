import { expect, type Page } from "@playwright/test";

export class AccountingPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/accounting");
  }

  async expectPostedJournalBalances(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Accounting", exact: true })).toBeVisible();
    await expect(this.page.getByText("Historical activation pending", { exact: true })).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Profit and loss", exact: true })).toBeVisible();
    await expect(this.page.getByText(/^ACCOUNTING_ACTIVATION_REQUIRED:/)).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Posted balance summary", exact: true })).toBeVisible();
    await expect(this.page.getByRole("row", { name: /1000 · Cash/ })).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Account activity", exact: true })).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Completed sale", exact: true })).toBeVisible();
  }

  async previewOpeningBalance(date: string, amount: string): Promise<void> {
    await this.page.getByLabel("Accounting start date").fill(date);
    await this.page.getByLabel("Opening amount 1").fill(amount);
    await this.page.getByRole("button", { name: "Preview opening entry" }).click();
    await expect(this.page.getByRole("heading", { name: /Balanced preview/ })).toBeVisible();
  }

  async confirmOpeningBalance(): Promise<void> {
    await this.page.getByRole("button", { name: "Confirm and post opening entry" }).click();
    await expect(this.page.getByText("Opening balances posted. Historical activation still needs review.", { exact: true })).toBeVisible();
  }

  async startBackfill(): Promise<void> {
    await this.page.getByRole("button", { name: "Start historical backfill" }).click();
    await expect(this.page.getByText(/Latest run: RUNNING/)).toBeVisible();
    await this.page.getByRole("button", { name: "Run next backfill batch" }).click();
  }

  async expectBackfillPausedForUnresolvedCosts(): Promise<void> {
    await expect(this.page.getByText("Backfill paused. Review unresolved values or confirm opening balances before restarting. Profit and loss remains unavailable.", { exact: true })).toBeVisible();
    await expect(this.page.getByRole("button", { name: "Restart historical backfill" })).toBeVisible();
    await expect(this.page.getByRole("list", { name: "Historical activation issues" }).getByText("historical_movement_cost_unavailable", { exact: true })).toBeVisible();
    await expect(this.page.getByText(/Latest run: PAUSED/)).toBeVisible();
  }
}
