import { expect, test } from "@playwright/test";
import { registerBusiness } from "./helpers";

test("workspace modal contains keyboard focus and restores it on close", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await registerBusiness(page, {
    ownerName: "Modal A11y Owner",
    email: `modal-a11y-${testInfo.project.name}-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: `Modal A11y Store ${stamp}`,
  });

  await page.goto("/products");
  const trigger = page.getByRole("button", { name: "+ Add product", exact: true });
  await trigger.focus();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Add product" });
  await expect(dialog).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
  ).toBe(true);

  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
