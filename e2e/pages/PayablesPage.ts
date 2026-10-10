import { expect, type Page } from "@playwright/test";

export class PayablesPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/payables");
  }

  async expectBillAndCreditBalance(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: "Supplier payables", exact: true })).toBeVisible();
    await expect(this.page.getByRole("row", { name: /Roaster.*INV-100/ })).toBeVisible();
    await expect(this.page.getByText("After posted payments and credits", { exact: true })).toBeVisible();
  }

  async expectBillDetail(): Promise<void> {
    await expect(this.page.getByRole("heading", { name: /Bill detail.*INV-100/ })).toBeVisible();
    await expect(this.page.getByRole("heading", { name: "Receipt allocations", exact: true })).toBeVisible();
    await expect(this.page.getByText(/3 units.*invoice/)).toBeVisible();
    await expect(this.page.getByText("BANK-1", { exact: false })).toBeVisible();
    await expect(this.page.getByText("CN-1", { exact: true })).toBeVisible();
  }
}
