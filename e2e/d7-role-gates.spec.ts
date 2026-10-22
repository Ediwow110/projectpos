import { expect, test } from "@playwright/test";
import { apiAuthedContext, createStaffMember, registerOperationalBusiness, signIn } from "./helpers";

/**
 * The web app must not contradict the API about what a session may do. The API
 * is the authority: GET /api/v1/me returns the session's effective permission
 * list, and settings.write is owner-only while gift_card.manage is withheld
 * from the cashier role.
 */
test("the workspace honours the server's permission list for staff sessions", async ({ page, request, viewport }) => {
  // The workspace destinations live in a collapsed disclosure on the desktop
  // layout and in a drawer on the narrow ones, so the navigation assertions
  // run at the desktop width. The authorization itself is layout independent
  // and is covered by the component tests at any width.
  test.skip((viewport?.width ?? 0) < 1280, "the navigation assertions need the desktop workspace layout");
  test.setTimeout(240_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "D7 Owner",
    email: `d7-owner-${stamp}@example.com`,
    password,
    businessName: "D7 QA",
  });
  const { headers } = await apiAuthedContext(request, ownerEmail, password, page);
  const managerEmail = `d7-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, headers, {
    email: managerEmail, name: "D7 Manager", role: "manager",
  });
  const cashierEmail = `d7-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, headers, {
    email: cashierEmail, name: "D7 Cashier", role: "cashier",
  });

  // The owner keeps the setup editor. A completed business shows the saved
  // settings first, so the step has to be selected to reach the editor.
  await signIn(page, ownerEmail, password);
  await page.goto("/onboarding");
  await page.getByRole("button", { name: /Currency & tax/i }).first().click();
  await expect(page.getByRole("button", { name: /Save & continue/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("You do not have access to business setup")).toHaveCount(0);

  // A manager holds no settings.write, so the owner-only editor must not be
  // offered at all - not even by direct URL.
  await signIn(page, managerEmail, manager.tempPassword);
  await page.goto("/onboarding");
  await expect(page.getByText("You do not have access to business setup")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Save & continue/i })).toHaveCount(0);
  await expect(page.getByLabel(/Tax rate/i)).toHaveCount(0);

  // The manager still holds gift_card.manage, so that destination stays. On
  // this surface the workspace destinations live in a collapsed disclosure, so
  // open it before asserting.
  await page.goto("/");
  await page.getByText("All workspace destinations").click();
  await expect(page.getByRole("link", { name: "Gift cards" }).first()).toBeVisible({ timeout: 30_000 });

  // A cashier holds neither, so the navigation must not offer the surface the
  // API refuses, and opening it directly must say so rather than render zeros.
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Gift cards" })).toHaveCount(0);
  await page.goto("/gift-cards");
  await expect(page.getByText("You do not have access to gift cards")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Outstanding liability")).toHaveCount(0);
  await expect(page.getByText("No gift cards have been issued.")).toHaveCount(0);
});
