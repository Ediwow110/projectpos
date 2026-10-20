import { expect, test } from "@playwright/test";

import { BUSINESS_ADMIN_DESTINATIONS } from "../apps/web/src/lib/admin-destinations";
import { flattenedWorkspaceNavigation } from "../apps/web/src/lib/workspace-navigation";

/**
 * Route-manifest smoke test.
 *
 * The 2026-10-20 frontend audit found staging serving routes that do not
 * exist in the source tree (/payables, /accounting) and missing routes that
 * do exist (/exceptions, /customer-concerns, /admin/owner-controls,
 * /admin/support, /platform/tenant-health, /platform/support-access,
 * /order-help). Nothing in the suite caught either class of drift, because
 * every existing spec reached a route by clicking a link it happened to
 * cover.
 *
 * This spec reads the navigation destinations from the same modules the app
 * renders from - so a destination that stops resolving fails the build
 * instead of waiting to be discovered by a human on staging.
 */

const ROLES = ["owner", "manager", "cashier", "inventory"] as const;

function manifestHrefs(): string[] {
  const hrefs = new Set<string>();
  for (const role of ROLES) {
    for (const item of flattenedWorkspaceNavigation(role)) hrefs.add(item.href);
  }
  for (const destination of BUSINESS_ADMIN_DESTINATIONS) hrefs.add(destination.href);
  return [...hrefs].sort();
}

test("every navigation destination resolves to a real route", async ({ page }, testInfo) => {
  // Route existence does not depend on the viewport, so the manifest is
  // walked once instead of three times.
  test.skip(testInfo.project.name !== "desktop", "route existence is viewport independent");

  const missing: string[] = [];

  for (const href of manifestHrefs()) {
    const response = await page.goto(href, { waitUntil: "domcontentloaded" });
    const status = response ? response.status() : 0;
    if (status === 404) missing.push(`${href} -> ${status}`);
  }

  expect(missing, `navigation destinations that 404: ${missing.join(", ")}`).toEqual([]);
});

test("the manifest check can still detect a route that does not exist", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "route existence is viewport independent");

  // Positive control: without this, a broken assertion above would let the
  // manifest test pass while every route actually 404s.
  const response = await page.goto("/__route-manifest-control-not-a-route", {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(404);
});
