import { expect, type Page } from "@playwright/test";

export class StoredValuePage {
  constructor(private readonly page: Page) {}

  async applyStoreCreditAdjustment(input: { amountMinor: string; counterAccountCode: string; reason: string }): Promise<void> {
    await this.page.getByLabel("Amount delta (minor)").fill(input.amountMinor);
    await this.page.getByRole("combobox", { name: "Counter account" }).selectOption(input.counterAccountCode);
    await this.page.getByRole("textbox", { name: "Reason" }).fill(input.reason);
    await this.page.getByRole("button", { name: "Apply" }).click();
  }

  async expectAdjustmentSaved(): Promise<void> {
    await expect(this.page.getByRole("status")).toContainText("Store-credit balance adjusted.");
  }
}
