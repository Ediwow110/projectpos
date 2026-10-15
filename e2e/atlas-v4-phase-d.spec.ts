import { expect, test } from "@playwright/test";

test("Atlas V4 Phase D guest and platform surfaces remain responsive and permission-aware", async ({ page }, testInfo) => {
  const screens = [
    { route: "/order-help", heading: "Need help with an order?", shell: "atlas-guest-help" },
    { route: "/platform/tenant-health", heading: "Platform tenant health", shell: "atlas-platform-shell" },
    { route: "/platform/support-access", heading: "Time-limited support access", shell: "atlas-platform-shell" },
  ] as const;
  for (const screen of screens) {
    await page.goto(screen.route);
    await expect(page.getByRole("heading", { name: screen.heading, level: 1, exact: true })).toBeVisible();
    await expect(page.locator(`[data-ui="${screen.shell}"]`)).toBeVisible();
    const width = page.viewportSize()?.width ?? 1440;
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${screen.route} overflow`).toBeLessThanOrEqual(width + 2);
    await page.screenshot({ path: `test-results/atlas-v4-phase-d-${screen.route.slice(1).replaceAll("/", "-")}-${testInfo.project.name}.png`, fullPage: false });
  }
  await page.goto("/order-help");
  const choices = page.getByRole("region", { name: "Order support paths" });
  for (const text of ["Find an existing order", "Report a problem", "Payment concerns", "Store contact"]) {
    await expect(choices.getByRole("link", { name: new RegExp(text) })).toHaveAttribute("href", "/order-status");
  }
  await page.goto("/platform/tenant-health");
  await expect(page.getByLabel("Operator key")).toHaveAttribute("type", "password");
  await expect(page.getByLabel("Owner consent token")).toHaveAttribute("type", "password");
  await expect(page.getByRole("region", { name: "Tenant diagnostics" })).toHaveCount(0);
  await page.goto("/platform/support-access");
  await expect(page.getByText("An operator cannot issue owner consent.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Owner consent controls" })).toHaveAttribute("href", "/admin/support");
});
