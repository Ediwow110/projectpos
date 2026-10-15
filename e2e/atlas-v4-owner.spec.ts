import { expect, test } from "@playwright/test";
import { registerOperationalBusiness } from "./helpers";

test("Atlas V4 owner portal preserves API-backed controls and responsive layout", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await registerOperationalBusiness(page, {
    ownerName: "Atlas QA Owner",
    email: "atlas-owner@example.test",
    password: "correct-horse-12",
    businessName: "Atlas QA Business",
  });

  await page.goto("/admin/owner-controls");
  await expect(page.getByRole("heading", { name: "Owner Control Center" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Owner overview" })).toBeVisible();
  await expect(page.getByText("TEAM ACCOUNTS")).toBeVisible();
  await expect(page.getByText("SENSITIVE REQUESTS")).toBeVisible();
  await expect(page.getByText("ACTIVE BRANCHES", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access & policies" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Team permissions" })).toHaveAttribute("href", "/team");
  await expect(page.getByRole("link", { name: "Financial policies" }).last()).toHaveAttribute("href", "#financial-policies");
  await expect(page.getByRole("link", { name: "Open approvals" })).toHaveAttribute("href", "/customer-concerns");
  if (testInfo.project.name === "desktop") {
    await expect(page.getByRole("navigation", { name: "Owner navigation" }).getByRole("link", { name: "Approval inbox" })).toHaveAttribute("href", "/customer-concerns");
  }
  await expect(page.getByRole("heading", { name: "Your active sessions" })).toBeVisible();

  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    shellWidth: document.querySelector('[data-ui="shell-sidebar"]')?.getBoundingClientRect().width ?? 0,
    sidebarVisible: (() => {
      const side = document.querySelector('[data-ui="shell-sidebar"]');
      return !!side && getComputedStyle(side).display !== "none";
    })(),
  }));
  expect(metrics.documentWidth, "Atlas V4 page must not overflow horizontally").toBeLessThanOrEqual(metrics.viewportWidth + 2);
  expect(metrics.sidebarVisible).toBe(testInfo.project.name === "desktop");
  if (testInfo.project.name === "desktop") expect(metrics.shellWidth).toBe(239);
  await page.screenshot({ path: `test-results/atlas-v4-owner-${testInfo.project.name}.png`, fullPage: false });
  await page.getByRole("link", { name: "Open approvals" }).click();
  await expect(page).toHaveURL(/\/customer-concerns$/);
  await expect(page.getByRole("heading", { name: "Manager approvals" })).toBeVisible();
});
