import { expect, test, type Locator, type Page } from "@playwright/test";
import { API, apiAuthedContext, registerOperationalBusiness } from "./helpers";

/**
 * WCAG contrast of the rendered text against its first opaque ancestor
 * background. Chromium resolves the cascade to rgb()/rgba(), so this reads the
 * real rendered colors rather than repeating a hex constant from the source.
 */
async function renderedContrast(locator: Locator): Promise<number> {
  return locator.evaluate((node) => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const parse = (value: string): Rgba | null => {
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (!match) return null;
      const parts = match[1]!.split(",").map((part) => Number(part.trim()));
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
    };
    const channel = (value: number): number => {
      const ratio = value / 255;
      return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color: Rgba): number =>
      0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    const foreground = parse(getComputedStyle(node).color) ?? { r: 0, g: 0, b: 0, a: 1 };
    let background: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    for (let element: Element | null = node; element; element = element.parentElement) {
      const candidate = parse(getComputedStyle(element).backgroundColor);
      if (candidate && candidate.a > 0.999) {
        background = candidate;
        break;
      }
    }
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return (light + 0.05) / (dark + 0.05);
  });
}

/** Resolves both optional onboarding steps so the business reaches a complete setup. */
async function skipOptionalSetup(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    const csrfResponse = await fetch("/api/v1/auth/csrf", { credentials: "include" });
    if (!csrfResponse.ok) return { ok: false, status: csrfResponse.status };
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    for (const step of ["products", "employees"]) {
      const response = await fetch("/api/v1/onboarding", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken },
        body: JSON.stringify({ step, state: "skipped" }),
      });
      if (!response.ok) return { ok: false, status: response.status };
    }
    return { ok: true, status: 200 };
  });
  expect(result.ok, `skipping optional setup failed with HTTP ${result.status}`).toBe(true);
}

test("owner can reach saved business settings and first-sale readiness without leaving the workspace", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await registerOperationalBusiness(page, {
    ownerName: "Atlas Business Setup QA",
    email: `owner-business-setup-${testInfo.project.name}-${Date.now()}@example.test`,
    password: "correct-horse-12",
    businessName: "Business Setup QA Business",
  });
  await skipOptionalSetup(page);

  // Record every mutation from the first workspace navigation through the
  // review journey. The registration helper already dismissed the first-run
  // tour before this window, so the journey must issue no writes at all.
  const writes: string[] = [];
  page.on("request", (request) => {
    const method = request.method();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return;
    writes.push(method + " " + path);
  });

  await page.goto("/");
  const overview = page.getByRole("region", { name: "Atlas owner overview" });
  await expect(overview.getByRole("heading", { name: "Owner overview" })).toBeVisible();

  if (testInfo.project.name === "desktop") {
    const ownerNavigation = page.getByRole("navigation", { name: "Owner navigation" });
    const activeLink = ownerNavigation.getByRole("link", { name: "Overview", exact: true });
    await expect(activeLink).toHaveAttribute("aria-current", "page");
    expect(await renderedContrast(activeLink), "active owner navigation contrast")
      .toBeGreaterThanOrEqual(4.5);
  }

  const readiness = overview.getByRole("region", { name: "First sale readiness" });
  await expect(readiness).toBeVisible();
  await expect(readiness.getByText("Not ready for first sale")).toBeVisible();
  await expect(readiness.getByText("Business setup is complete")).toBeVisible();
  await expect(readiness.getByRole("link", { name: "Sellable product with available stock" })).toHaveAttribute("href", "/products");
  await expect(readiness.getByRole("link", { name: "Active register" })).toHaveAttribute("href", "/registers");
  await expect(readiness.getByRole("link", { name: "Open shift" })).toHaveAttribute("href", "/shifts");
  // A register does not depend on a branch, so a branch is never presented as a
  // prerequisite for the first sale.
  await expect(readiness.getByRole("link", { name: "Branches" })).toHaveCount(0);

  // Readiness links are standalone actions, not inline prose: their clickable
  // box, not just their text height, must meet the 44px owner target.
  for (const name of ["Sellable product with available stock", "Active register", "Open shift"]) {
    const box = await readiness.getByRole("link", { name }).boundingBox();
    expect(box, `${name} must render`).not.toBeNull();
    expect(box!.height, `${name} hit target`).toBeGreaterThanOrEqual(44);
  }

  // Secondary owner labels must pass WCAG AA against their rendered surfaces.
  for (const label of ["Net sales in selected period", "Sales in selected period", "Reported attention items"]) {
    const metricLabel = overview.getByText(label, { exact: true });
    await expect(metricLabel).toBeVisible();
    expect(await renderedContrast(metricLabel), `${label} contrast`).toBeGreaterThanOrEqual(4.5);
  }
  const reportFootnote = overview.getByText(/Report values reflect the selected period/);
  expect(await renderedContrast(reportFootnote), "owner report footnote contrast").toBeGreaterThanOrEqual(4.5);

  const reviewLink = readiness.getByRole("link", { name: "Review business setup" });
  await expect(reviewLink).toHaveAttribute("href", "/onboarding");

  await reviewLink.click();
  await expect(page).toHaveURL(/\/onboarding$/);

  const saved = page.getByRole("region", { name: "Saved business settings" });
  await expect(saved).toBeVisible();
  await expect(saved.getByText("123 Test Street, Manila")).toBeVisible();
  await expect(saved.getByText("Asia/Manila")).toBeVisible();
  await expect(saved.getByText("PHP · No tax")).toBeVisible();
  await expect(saved.getByText("0% tax rate")).toBeVisible();
  await expect(saved.getByText("Standard receipt confirmed")).toBeVisible();

  // A completed owner lands on a meaningful required step, not a skipped tail step.
  await expect(page.getByRole("heading", { name: "Business details" })).toBeVisible();
  await expect(page.getByText("STEP 01 / 05")).toBeVisible();
  await expect(page.getByText("This step is complete")).toBeVisible();
  await expect(page.getByRole("link", { name: "NexPOS home" })).toHaveAttribute("href", "/");

  // Reviewing a saved step must not write anything.
  await page.waitForLoadState("networkidle");
  expect(writes, `viewing saved settings issued writes: ${writes.join(", ")}`).toEqual([]);

  // A query refresh and a fresh direct visit must also stay read-only.
  await page.reload();
  await expect(page.getByRole("region", { name: "Saved business settings" })).toBeVisible();
  await page.goto("/onboarding");
  await expect(page.getByRole("region", { name: "Saved business settings" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(writes, `the review journey issued writes: ${writes.join(", ")}`).toEqual([]);

  const backLink = page.getByRole("link", { name: "← Back to dashboard" });
  const backBox = await backLink.boundingBox();
  expect(backBox, "back to dashboard must render").not.toBeNull();
  expect(backBox!.height, "back to dashboard hit target").toBeGreaterThanOrEqual(44);
  await backLink.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(overview.getByRole("heading", { name: "Owner overview" })).toBeVisible();

  // Direct navigation back to the review surface keeps the saved values and does
  // not reset progress.
  await page.goto("/onboarding");
  await expect(page.getByRole("region", { name: "Saved business settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Business details" })).toBeVisible();
  await expect(page.getByText("STEP 01 / 05")).toBeVisible();

  // Browser back/forward keeps the owner inside the workspace.
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("region", { name: "Saved business settings" })).toBeVisible();

  // The Atlas owner rail is a desktop destination list: it is hidden below the
  // xl breakpoint, where the mobile header takes over and the readiness card
  // link is the owner path to business setup.
  await page.goto("/");
  await page.getByText("Detailed analytics, trends and operational reports").click();
  const greeting = page.getByText(/^Good (morning|afternoon|evening)$/).first();
  await expect(greeting).toBeVisible();
  expect(await renderedContrast(greeting), "page eyebrow greeting contrast").toBeGreaterThanOrEqual(4.5);

  if (testInfo.project.name === "desktop") {
    const nav = page.getByRole("navigation", { name: "Owner navigation" });
    const setupLink = nav.getByRole("link", { name: "Business setup", exact: true });
    await expect(setupLink).toHaveAttribute("href", "/onboarding");
    await setupLink.click();
    await expect(page).toHaveURL(/\/onboarding$/);
  } else {
    await page.getByRole("link", { name: "Review business setup" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  }
  await expect(page.getByRole("region", { name: "Saved business settings" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(writes, `direct owner navigation issued writes: ${writes.join(", ")}`).toEqual([]);
});

test("signed-out owners are redirected away from the business setup surface", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in to NexPOS" })).toBeVisible();
});

test("business setup review stays readable and free of horizontal overflow", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await registerOperationalBusiness(page, {
    ownerName: "Atlas Business Setup Responsive QA",
    email: `owner-business-setup-responsive-${testInfo.project.name}-${Date.now()}@example.test`,
    password: "correct-horse-12",
    businessName: "Business Setup Responsive QA Business",
  });
  await skipOptionalSetup(page);
  await page.goto("/onboarding");

  // The desktop project owns the full width sweep; the mobile-emulated
  // project keeps its own 390px viewport because Chromium device emulation
  // does not reliably re-layout on an arbitrary resize.
  const widths = testInfo.project.name === "desktop"
    ? [390, 820, 1024, 1280, 1440]
    : [testInfo.project.name === "mobile" ? 390 : 1024];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const saved = page.getByRole("region", { name: "Saved business settings" });
    await expect(saved).toBeVisible();
    const widths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(widths.documentWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(widths.viewportWidth + 2);
  }

  // The desktop project owns the full owner-overview width sweep as well: the
  // rail appears at xl (1280px), so the 1024/1280 boundary needs explicit proof.
  if (testInfo.project.name === "desktop") {
    for (const width of [390, 820, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Owner overview" })).toBeVisible();
      const viewport = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(viewport.documentWidth, `owner horizontal overflow at ${width}px`)
        .toBeLessThanOrEqual(viewport.viewportWidth + 2);
    }
  }
});

test("the business setup link is reachable by keyboard", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await registerOperationalBusiness(page, {
    ownerName: "Atlas Business Setup Keyboard QA",
    email: `owner-business-setup-keyboard-${testInfo.project.name}-${Date.now()}@example.test`,
    password: "correct-horse-12",
    businessName: "Business Setup Keyboard QA Business",
  });
  await skipOptionalSetup(page);
  await page.goto("/");

  const reviewLink = page.getByRole("link", { name: "Review business setup" });
  await reviewLink.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const focused = await page.evaluate(() => ({
    text: document.activeElement?.textContent?.trim() ?? "",
    focusVisible: document.activeElement instanceof HTMLElement && document.activeElement.matches(":focus-visible"),
  }));
  expect(focused.text).toBe("Review business setup");
  expect(focused.focusVisible).toBe(true);
});

test("the below-xl workspace menu offers owners the business setup destination", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  // The Atlas owner rail is a desktop-only destination list, so below the xl
  // breakpoint the shared workspace navigation is the owner's route to it.
  test.skip(testInfo.project.name === "desktop", "the owner rail is always visible at desktop width");

  await registerOperationalBusiness(page, {
    ownerName: "Atlas Business Setup Mobile QA",
    email: `owner-business-setup-mobile-${testInfo.project.name}-${Date.now()}@example.test`,
    password: "correct-horse-12",
    businessName: "Business Setup Mobile QA Business",
  });
  await skipOptionalSetup(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Open workspace menu" }).click();
  const menu = page.getByRole("navigation", { name: "More workspace navigation" });
  await expect(menu).toBeVisible();

  const sectionHeadings = menu.locator("section > p");
  const sectionCount = await sectionHeadings.count();
  expect(sectionCount, "drawer section headings must render").toBeGreaterThan(0);
  for (let index = 0; index < sectionCount; index += 1) {
    expect(await renderedContrast(sectionHeadings.nth(index)), `drawer heading ${index} contrast`)
      .toBeGreaterThanOrEqual(4.5);
  }

  const setupLink = menu.getByRole("link", { name: "Business setup", exact: true });
  await expect(setupLink).toHaveAttribute("href", "/onboarding");
  const setupBox = await setupLink.boundingBox();
  expect(setupBox, "the business setup menu link must render").not.toBeNull();
  expect(setupBox!.height, "below-xl workspace menu hit target").toBeGreaterThanOrEqual(44);

  // The mobile entry is keyboard reachable and shows a focus ring. A real
  // keyboard event is required for :focus-visible to apply, so drive focus
  // with Tab/Shift+Tab rather than a programmatic focus() alone.
  await setupLink.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const focused = await page.evaluate(() => ({
    text: document.activeElement?.textContent?.trim() ?? "",
    focusVisible: document.activeElement instanceof HTMLElement && document.activeElement.matches(":focus-visible"),
  }));
  expect(focused.text).toContain("Business setup");
  expect(focused.focusVisible).toBe(true);

  await setupLink.click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("region", { name: "Saved business settings" })).toBeVisible();

  // The compact menu uses the same token: verify its active row in the real
  // browser at this breakpoint, not only the desktop owner rail.
  await page.goto("/team");
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  const teamLink = page.getByRole("navigation", { name: "More workspace navigation" })
    .getByRole("link", { name: "Team", exact: true });
  await expect(teamLink).toHaveAttribute("aria-current", "page");
  expect(await renderedContrast(teamLink), "compact active navigation contrast")
    .toBeGreaterThanOrEqual(4.5);
});

test("non-owner roles are never offered the business setup destination", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Atlas Business Setup Role QA",
    email: `owner-business-setup-role-${testInfo.project.name}-${Date.now()}@example.test`,
    password: "correct-horse-12",
    businessName: "Business Setup Role QA Business",
  });
  const ownerAuth = await apiAuthedContext(request, ownerEmail, "correct-horse-12", page);
  const cashierEmail = `cashier-business-setup-${testInfo.project.name}-${Date.now()}@example.test`;
  const created = await request.post(`${API}/api/v1/memberships`, {
    headers: ownerAuth.headers,
    data: { email: cashierEmail, name: "Business Setup Cashier", role: "cashier" },
  });
  expect(created.ok()).toBe(true);
  const membership = (await created.json()) as { tempPassword?: string };
  expect(membership.tempPassword).toBeTruthy();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(cashierEmail);
  await page.getByLabel("Password").fill(membership.tempPassword!);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/);

  // The first-run tour is a modal overlay that intercepts pointer events, and
  // it appears asynchronously after the session resolves. Wait for it rather
  // than sampling its presence, otherwise the check races the tour's render.
  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  const tourAppeared = await tour
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (tourAppeared) {
    await tour.getByRole("button", { name: "Skip tour" }).click();
    await expect(tour).toBeHidden();
  }

  await expect(page.locator('a[href="/onboarding"]')).toHaveCount(0);
  if (testInfo.project.name !== "desktop") {
    // Owners get the Atlas mobile header; other roles keep the legacy shell
    // whose disclosure is labelled "More workspace navigation".
    const atlasMenu = page.getByRole("button", { name: "Open workspace menu" });
    if (await atlasMenu.count()) {
      await atlasMenu.click();
    } else {
      await page.getByRole("button", { name: /More workspace navigation/ }).first().click();
    }
    const menu = page.getByRole("navigation", { name: "More workspace navigation" });
    await expect(menu).toBeVisible();
    await expect(menu.locator('a[href="/onboarding"]')).toHaveCount(0);
  }
});
