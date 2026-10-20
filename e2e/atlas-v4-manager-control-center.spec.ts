import { expect, test } from "@playwright/test";
import { apiAuthedContext, createStaffMember, registerOperationalBusiness, signIn } from "./helpers";

test("Atlas V4 manager control center uses own scoped reports and protects platform tenant access", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const password = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Manager Overview QA",
    email: `manager-overview-owner-${testInfo.project.name}-${Date.now()}@example.com`,
    password,
    businessName: "Manager Overview QA",
  });
  const { headers } = await apiAuthedContext(request, ownerEmail, password, page);
  const managerEmail = `manager-overview-staff-${testInfo.project.name}-${Date.now()}@example.com`;
  const manager = await createStaffMember(request, headers, { name: "Manager QA", email: managerEmail, role: "manager" });
  await signIn(page, managerEmail, manager.tempPassword);
  await page.goto("/");

  const center = page.getByRole("region", { name: "Manager control center" });
  await expect(center.getByRole("heading", { name: "Manager control center" })).toBeVisible();
  await expect(center.getByRole("link", { name: "Review exceptions" })).toHaveAttribute("href", "/exceptions");
  await expect(center.getByRole("link", { name: "Open manager approvals" })).toHaveAttribute("href", "/customer-concerns");
  await expect(center.getByText("Orders in selected period")).toBeVisible();
  await expect(center.getByText("Reported attention items", { exact: true })).toBeVisible();
  await expect(center.getByText("Net sales in selected period")).toBeVisible();
  const range = center.getByRole("combobox", { name: "Manager report period" });
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
    && new URL(response.url()).searchParams.get("dateFrom") !== today,
  );
  await range.selectOption("7");
  await sevenDayRequest;
  await expect(range).toHaveValue("7");
  await expect(center.getByRole("link", { name: /Shift readiness/ })).toHaveAttribute("href", "/shifts");
  await expect(page.getByRole("heading", { name: "Tenant directory", exact: true })).toHaveCount(0);

  if (testInfo.project.name === "desktop") {
    const rail = page.locator('[data-ui="shell-sidebar"]');
    expect((await rail.boundingBox())?.width).toBeCloseTo(230, 0);
    await expect(page.getByRole("navigation", { name: "Approval navigation" }).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  } else {
    await expect(page.locator('[data-ui="atlas-mobile-header"]')).toBeVisible();
  }
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 2);
  await page.screenshot({ path: `test-results/atlas-manager-control-center-${testInfo.project.name}.png`, fullPage: false });
  await center.getByRole("link", { name: "Open manager approvals" }).click();
  await expect(page).toHaveURL(/\/customer-concerns$/);
  await expect(page.getByRole("heading", { name: /Manager approval/ }).first()).toBeVisible();

  // Business manager is not a platform administrator or owner.
  await page.goto("/admin");
  await expect(page.getByRole("region", { name: "Business administration scope" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Owner controls/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Open Team/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tenant directory" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Administration destinations" }).getByRole("link", { name: /Devices/ })).toHaveAttribute("href", "/devices");
});
