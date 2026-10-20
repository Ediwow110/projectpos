import { expect, test } from "@playwright/test";
import { apiAuthedContext, createStaffMember, registerOperationalBusiness, signIn } from "./helpers";

test("Atlas V4 manager inbox uses authorized requests and responsive navigation", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Atlas Approvals Owner",
    email: "atlas-approvals-owner@example.test",
    password,
    businessName: "Atlas Approvals QA",
  });
  const owner = await apiAuthedContext(request, email, password, page);
  const managerEmail = `atlas-manager-${testInfo.project.name}-${Date.now()}@example.test`;
  const manager = await createStaffMember(request, owner.headers, {
    name: "Atlas Manager",
    email: managerEmail,
    role: "manager",
  });
  await signIn(page, managerEmail, manager.tempPassword);
  await page.goto("/customer-concerns");

  if (testInfo.project.name === "mobile") {
    await expect(page.getByRole("heading", { name: "Approval requests", level: 1 })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Manager approval inbox", level: 1 })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Approval overview" })).toBeVisible();
  const mobileRequests = page.getByRole("region", { name: "Mobile approval requests" });
  for (const label of ["PENDING DECISIONS", "SALES REQUESTS", "OTHER REQUESTS"]) {
    const metric = page.getByText(label, { exact: true });
    if (testInfo.project.name === "mobile") {
      await expect(metric).toBeHidden();
    } else {
      await expect(metric).toBeVisible();
    }
  }
  if (testInfo.project.name === "mobile") {
    await expect(mobileRequests).toBeVisible();
    await expect(mobileRequests.getByRole("heading", { name: "Pending approval requests" })).toBeVisible();
  } else {
    await expect(mobileRequests).toBeHidden();
  }
  const desktopQueue = page.getByRole("region", { name: "Awaiting approval" });
  if (testInfo.project.name === "mobile") {
    await expect(desktopQueue).toBeHidden();
  } else {
    await expect(desktopQueue).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Approval controls" })).toBeVisible();
  await expect(page.getByLabel("Approval status")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const side = document.querySelector('[data-ui="shell-sidebar"]');
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      sidebarVisible: !!side && getComputedStyle(side).display !== "none",
      sidebarWidth: side?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(metrics.documentWidth, "Manager desk should not scroll horizontally").toBeLessThanOrEqual(metrics.viewportWidth + 2);
  expect(metrics.sidebarVisible).toBe(testInfo.project.name === "desktop");
  if (testInfo.project.name === "desktop") {
    expect(metrics.sidebarWidth).toBe(230);
    await expect(page.getByRole("navigation", { name: "Approval navigation" }).getByRole("link", { name: "Approval inbox" })).toHaveAttribute("aria-current", "page");
  }
  await page.screenshot({ path: `test-results/atlas-v4-approvals-${testInfo.project.name}.png`, fullPage: false });
  const review = testInfo.project.name === "mobile"
    ? mobileRequests.getByRole("link", { name: "Open request review" })
    : desktopQueue.getByRole("link", { name: "Review requests" });
  if (testInfo.project.name === "mobile") {
    expect(await review.evaluate((node) => getComputedStyle(node).position)).toBe("fixed");
    expect(await review.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(53);
  }
  await review.click();
  await expect(page.getByRole("heading", { name: "Manager approvals", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#manager-approval-details$/);
});

test("Atlas V4 approval queue links follow the active request filters", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Atlas Filter Owner",
    email: "atlas-filter-owner@example.test",
    password,
    businessName: "Atlas Filter QA",
  });
  const owner = await apiAuthedContext(request, email, password, page);
  const managerEmail = `atlas-filter-manager-${testInfo.project.name}-${Date.now()}@example.test`;
  const manager = await createStaffMember(request, owner.headers, {
    name: "Atlas Filter Manager",
    email: managerEmail,
    role: "manager",
  });
  await signIn(page, managerEmail, manager.tempPassword);

  const requestRow = (id: string, status: string) => ({
    id,
    requesterId: "qa-requester",
    branchId: null,
    registerId: null,
    kind: "discount",
    requesterName: "QA Cashier",
    branchName: null,
    registerName: null,
    permission: "sale.discount",
    action: { kind: "discount", lines: [], orderDiscountMinor: 0 },
    context: null,
    status,
    decisionReason: null,
    createdAt: new Date().toISOString(),
  });
  await page.route("**/api/v1/approvals/requests", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      requests: [requestRow("qa-pending", "PENDING"), requestRow("qa-approved", "APPROVED")],
    }),
  }));

  await page.goto("/customer-concerns");
  const pendingLink = page.locator('a[href="#manager-approval-qa-pending"]');
  await expect(pendingLink).toHaveCount(2); // Mobile card and desktop queue are both in the DOM.
  await expect(page.locator("#manager-approval-qa-pending")).toHaveCount(1);
  await page.getByLabel("Approval status").selectOption("APPROVED");
  await expect(pendingLink).toHaveCount(0);
  await expect(page.locator("#manager-approval-qa-pending")).toHaveCount(0);
  await expect(page.locator("#manager-approval-qa-approved")).toHaveCount(1);
  await page.getByLabel("Approval status").selectOption("PENDING");
  await expect(pendingLink).toHaveCount(2);
  await expect(page.locator("#manager-approval-qa-pending")).toHaveCount(1);
});
