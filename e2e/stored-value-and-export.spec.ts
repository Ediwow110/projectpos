import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { API, apiAuthedContext, registerOperationalBusiness } from "./helpers";

test("stored value, its liability report and the ledger extract are reachable from the app", async ({ page, request }, testInfo) => {
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Stored Value Owner",
    email: "stored-value-owner@example.com",
    password,
    businessName: "Liability Store",
  });
  const auth = await apiAuthedContext(request, email, password, page);

  const issued = await request.post(`${API}/api/v1/gift-cards/issue`, {
    headers: auth.headers,
    data: { idempotencyKey: `issue-${testInfo.workerIndex}-${Date.now()}` },
  });
  expect(issued.status(), await issued.text()).toBe(201);
  const cardId = ((await issued.json()) as { id: string }).id;

  await page.goto(`/gift-cards/${cardId}`);
  await page.getByPlaceholder("Refunded to card after dispute").fill("Promo load credited by mistake");
  await page.getByPlaceholder("-25.50").fill("50.00");
  await page.getByRole("button", { name: "Apply adjustment" }).click();
  await expect(page.getByText("Balance adjusted by 50.00.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Promo load credited by mistake" })).toContainText("50.00");

  // A reason is mandatory because the status change is an audit event.
  await page.getByPlaceholder("Reported lost by the holder").fill("Holder reported the card lost");
  await page.getByRole("button", { name: "Suspend card" }).click();
  await expect(page.getByText("Card marked SUSPENDED.")).toBeVisible();

  await page.goto("/reports/stored-value");
  const giftCardMetric = page.locator('[data-ui="metric-card"]').filter({ hasText: "Gift-card liability" });
  await expect(giftCardMetric).toContainText("₱50.00");
  await expect(giftCardMetric).toContainText("1 cards");
  await expect(page.locator('[data-ui="metric-card"]').filter({ hasText: "Total liability" })).toContainText("₱50.00");

  await page.goto("/reports/ledger");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download ledger CSV" }).click();
  const download = await downloadPromise;
  const saved = await download.path();
  expect(saved).toBeTruthy();
  const bom = String.fromCharCode(0xfeff);
  const firstLine = readFileSync(saved as string, "utf8").split("\n")[0].replace(bom, "");
  expect(firstLine).toBe("date,type,ref,account,debitMinor,creditMinor,memo");
});
