import { expect, test, type Page } from "@playwright/test";
import {
  API, apiAuthedContext, createStaffMember, registerOperationalBusiness,
  signIn,
} from "./helpers";

const SIZES = [
  { label: "mobile", width: 390, height: 844 },
  { label: "tablet", width: 820, height: 1180 },
  { label: "pos-tablet", width: 1024, height: 768 },
  { label: "management", width: 1280, height: 900 },
  { label: "desktop", width: 1440, height: 900 },
] as const;

async function checkViewport(page: Page, route: string, width: number): Promise<void> {
  const metrics = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    headings: document.querySelectorAll("h1").length,
    main: document.querySelectorAll("main").length,
  }));
  expect(metrics.document, `${route}: document overflow at ${width}px (actual ${metrics.document})`)
    .toBeLessThanOrEqual(width + 2);
  expect(metrics.headings, `${route}: missing page heading`).toBeGreaterThanOrEqual(1);
  expect(metrics.main, `${route}: missing main landmark`).toBeGreaterThanOrEqual(1);
}

test("Phase E: owner / manager / cashier routes reflow across five viewports", async ({ page, request }) => {
  test.setTimeout(270_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Phase E Owner", email: `phase-e-owner-${stamp}@example.com`,
    password, businessName: "Phase E Local QA",
  });
  const auth = await apiAuthedContext(request, ownerEmail, password, page);
  const managerEmail = `phase-e-manager-${stamp}@example.com`;
  const cashierEmail = `phase-e-cashier-${stamp}@example.com`;
  const manager = await createStaffMember(request, auth.headers, { name: "Phase E Manager", email: managerEmail, role: "manager" });
  const cashier = await createStaffMember(request, auth.headers, { name: "Phase E Cashier", email: cashierEmail, role: "cashier" });

  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const path of ["/team", "/admin/owner-controls", "/customer-concerns", "/receipts/lookup", "/admin/support"]) {
      await page.goto(path);
      await expect(page.locator("h1:visible")).toHaveCount(1);
      await checkViewport(page, path, size.width);
      await page.screenshot({ path: `test-results/atlas-v4-phase-e-${path.slice(1).replaceAll("/", "-")}-${size.label}.png`, fullPage: false });
      if (path === "/team") {
        const mobileAccess = page.getByRole("region", { name: "Mobile employee access" });
        if (size.width < 640) {
          await expect(mobileAccess).toBeVisible();
          await expect(page.getByRole("table")).toBeHidden();
          await expect(mobileAccess.getByText("Phase E Cashier")).toBeVisible();
          await expect(mobileAccess.locator("article").first()).toContainText("Phase E Manager");
          await expect(page.getByRole("heading", { name: "Employee access" })).toBeVisible();
          await expect(page.getByRole("region", { name: "Mobile employee permissions" })).toBeVisible();
        } else {
          await expect(mobileAccess).toBeHidden();
          await expect(page.getByRole("table")).toBeVisible();
        }
      }
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/team");
  const atlasHeader = page.locator('[data-ui="atlas-mobile-header"]');
  await expect(atlasHeader).toBeVisible();
  await expect(atlasHeader.getByText("NexPOS")).toBeVisible();
  await expect(atlasHeader.getByText("owner", { exact: true })).toBeVisible();
  const atlasMenuButton = atlasHeader.getByRole("button", { name: "Open workspace menu" });
  await expect(atlasMenuButton).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
  await atlasMenuButton.click();
  await expect(atlasHeader.getByRole("button", { name: "Close workspace menu" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.locator('[data-ui="shell-mobile-more"]').getByLabel("Active branch")).toBeVisible();
  await expect(page.locator('[data-ui="shell-mobile-more"]').getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
  const permissions = page.getByRole("button", { name: "Permissions", exact: true }).first();
  await expect(permissions).toBeVisible();
  expect(await permissions.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await permissions.click();
  const dialog = page.getByRole("dialog", { name: "Employee permission restrictions" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByText("Allowed", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/atlas-v4-phase-e-employee-permissions-mobile.png", fullPage: false });
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  expect(await close.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(permissions).toBeFocused();

  await signIn(page, managerEmail, manager.tempPassword);
  await page.goto("/customer-concerns");
  await expect(page.getByRole("heading", { name: "Manager approvals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval requests", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mobile approval requests" })).toBeVisible();
  const reviewEntry = page.getByRole("region", { name: "Mobile approval requests" }).getByRole("link", { name: "Open request review" });
  await expect(reviewEntry).toHaveAttribute("href", "#manager-approval-details");
  expect(await reviewEntry.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await checkViewport(page, "/customer-concerns", 390);
  await expect(page.getByLabel("Approval status")).toBeVisible();
  await page.getByLabel("Approval status").selectOption("REJECTED");
  await expect(page.getByText("No approvals match the selected filters.")).toBeVisible();

  await signIn(page, cashierEmail, cashier.tempPassword);
  for (const path of ["/receipts/lookup", "/customer-concerns"]) {
    await page.goto(path);
    await expect(page.locator("h1:visible")).toHaveCount(1);
    await checkViewport(page, path, 390);
  }
  await page.goto("/receipts/lookup");
  await expect(page.getByRole("region", { name: "Receipt lookup result" })).not.toContainText("Receipt 2026-");
  const input = page.getByLabel("Receipt number");
  await input.fill("INVALID-RECEIPT");
  await input.press("Enter");
  await expect(page.getByText("No matching receipt is available within your current access.")).toBeVisible();
  expect((await request.get(`${API}/api/v1/admin/support/cases`, {
    headers: (await apiAuthedContext(request, cashierEmail, cashier.tempPassword, page)).headers,
  })).status()).toBe(403);
});

test("Phase E: unauthenticated and reduced-motion states expose no private data", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/order-status#token=invalid-token");
  await expect(page.getByRole("heading", { name: "Status unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Need help with this order?" })).toHaveCount(0);
  expect(page.url()).not.toContain("invalid-token");

  await page.goto("/platform/tenant-health");
  await expect(page.getByRole("heading", { name: "Platform tenant health", level: 1 })).toBeVisible();
  await checkViewport(page, "/platform/tenant-health", 390);
  const operator = page.getByLabel("Operator key");
  await operator.fill("wrong-key");
  await page.getByLabel("Owner consent token").fill("wrong-consent");
  await page.getByLabel("Business ID").fill("invalid-business");
  await page.getByRole("button", { name: "View authorized diagnostics" }).click();
  await expect(page.getByText("Operator credentials or active owner consent could not be verified.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Tenant diagnostics" })).toHaveCount(0);
  await page.goto("/order-help");
  await expect(page.getByRole("heading", { name: "Need help with an order?" })).toBeVisible();
  await checkViewport(page, "/order-help", 390);
  await page.goto("/platform/support-access");
  await expect(page.getByRole("heading", { name: "Time-limited support access" })).toBeVisible();
  await checkViewport(page, "/platform/support-access", 390);

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const visualMotion = await page.evaluate(() => {
    const probe = document.querySelector("button");
    return probe ? getComputedStyle(probe).transitionDuration : null;
  });
  expect(visualMotion).not.toBeNull();
  if (visualMotion) {
    const values = visualMotion.split(",").map((x) => parseFloat(x.trim()) || 0);
    expect(Math.max(...values)).toBeLessThan(0.01);
  }
});
