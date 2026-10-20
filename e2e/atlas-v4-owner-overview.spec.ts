import { expect, test } from "@playwright/test";
import { registerOperationalBusiness } from "./helpers";

test("Atlas V4 owner landing shows authoritative overview and preserves owner control center", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await registerOperationalBusiness(page, {
    ownerName: "Atlas Owner Landing QA",
    email: `owner-landing-${testInfo.project.name}-${Date.now()}@example.test`,
    password: "correct-horse-12",
    businessName: "Owner Landing QA Business",
  });
  await page.goto("/");
  const overview = page.getByRole("region", { name: "Atlas owner overview" });
  await expect(overview.getByRole("heading", { name: "Owner overview" })).toBeVisible();
  await expect(page.locator('[data-ui="atlas-owner-shell"]')).toBeVisible();
  await expect(overview.getByRole("link", { name: "Open sales reports" })).toHaveAttribute("href", "/reports/sales");
  await expect(overview.getByText("Net sales in selected period")).toBeVisible();
  await expect(overview.getByText("Sales in selected period", { exact: true })).toBeVisible();
  await expect(overview.getByText("Reported attention items", { exact: true })).toBeVisible();
  const range = overview.getByRole("combobox", { name: "Owner report period" });
  await expect(range).toHaveValue("30");
  const todayRequest = page.waitForResponse((response) =>
    response.url().includes("/api/v1/dashboard/overview?") && response.status() === 200
    && new URL(response.url()).searchParams.has("dateFrom"),
  );
  await range.selectOption("0");
  const today = new URL((await todayRequest).url()).searchParams.get("dateFrom");
  expect(today).toBeTruthy();
  await expect(range).toHaveValue("0");
  const sevenDayRequest = page.waitForResponse((response) =>
    response.url().includes("/api/v1/dashboard/overview?") && response.status() === 200
    && new URL(response.url()).searchParams.has("dateFrom")
    && new URL(response.url()).searchParams.get("dateFrom") !== today,
  );
  await range.selectOption("7");
  await sevenDayRequest;
  await expect(range).toHaveValue("7");
  await page.screenshot({ path: `test-results/atlas-owner-overview-${testInfo.project.name}.png`, fullPage: false });
  await expect(page.locator('[data-ui="owner-detailed-analytics"]')).toBeVisible();
  await expect(page.locator('[data-ui="owner-detailed-analytics"]')).not.toHaveAttribute("open", "");
  await page.locator('[data-ui="owner-detailed-analytics"] summary').click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.locator('[data-ui="owner-detailed-analytics"] summary').click();

  if (testInfo.project.name === "desktop") {
    const side = page.locator('[data-ui="shell-sidebar"]');
    expect((await side.boundingBox())?.width).toBeCloseTo(239, 0);
    const nav = page.getByRole("navigation", { name: "Owner navigation" });
    await expect(nav.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Owner controls" })).toHaveAttribute("href", "/admin/owner-controls");
    await nav.getByRole("link", { name: "Owner controls" }).click();
  } else {
    await expect(page.locator('[data-ui="atlas-mobile-header"]')).toBeVisible();
    const menu = page.getByRole("button", { name: "Open workspace menu" });
    await menu.click();
    await page.getByRole("navigation", { name: "More workspace navigation" }).getByRole("link", { name: "Owner controls" }).click();
  }
  await expect(page).toHaveURL(/\/admin\/owner-controls$/);
  await expect(page.getByRole("heading", { name: "Owner Control Center" })).toBeVisible();
  const widths = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(widths.documentWidth).toBeLessThanOrEqual(widths.viewportWidth + 2);
});
