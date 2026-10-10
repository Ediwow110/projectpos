import { expect, test } from "@playwright/test";
import { AccountingPage } from "./pages/AccountingPage";

test("owner reviews posted journal balances with completeness called out", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => route.fulfill({ json: {
    userId: "e2e-owner", businessId: "e2e-business", businessName: "Accounting E2E", role: "owner",
    onboardingRequired: false, workspaceTourSeen: true, activeBranchId: null, activeBranchName: null,
  } }));
  await page.route("**/api/v1/branches", async (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/v1/accounting/accounts", async (route) => route.fulfill({ json: [{ id: "cash", code: "1000", name: "Cash", type: "asset", isActive: true }] }));
  await page.route("**/api/v1/accounting/trial-balance", async (route) => route.fulfill({ json: {
    items: [{ accountId: "cash", code: "1000", name: "Cash", type: "asset", debitMinor: 12000, creditMinor: 0, debitBalanceMinor: 12000, creditBalanceMinor: 0 }],
    debitMinor: 12000, creditMinor: 12000, currency: "PHP", completeness: "posted-journal-only",
  } }));
  await page.route("**/api/v1/accounting/profit-and-loss**", async (route) => route.fulfill({ status: 409, json: { code: "ACCOUNTING_ACTIVATION_REQUIRED", message: "Profit and loss is unavailable until historical activation and reconciliation are complete" } }));
  await page.route("**/api/v1/accounting/journal**", async (route) => route.fulfill({ json: {
    items: [{ entry: { id: "entry-1", effectiveAt: "2026-10-10T12:00:00.000Z", description: "Completed sale", sourceType: "Sale", sourceId: "sale-1" }, lines: [
      { accountId: "cash", debitMinor: 12000, creditMinor: 0, memo: "Cash tender" },
      { accountId: "revenue", debitMinor: 0, creditMinor: 12000, memo: "Merchandise revenue" },
    ] }], nextCursor: null,
  } }));
  await page.route("**/api/v1/accounting/journal.csv**", async (route) => route.fulfill({ contentType: "text/csv; charset=utf-8", body: "\uFEFFdate,sourceType,sourceId,accountCode,accountName,debitMinor,creditMinor,memo\n" }));

  const accounting = new AccountingPage(page);
  await accounting.goto();
  await accounting.expectPostedJournalBalances();
  await page.getByRole("combobox", { name: "Account activity filter" }).selectOption("cash");
  await expect(page.getByRole("heading", { name: "Completed sale", exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download journal CSV" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("nexpos-accounting-journal.csv");
});

test("owner previews and confirms balanced opening worksheet", async ({ page }) => {
  let status = "NOT_STARTED";
  let openingEntryId: string | null = null;
  await page.route("**/api/v1/me", async (route) => route.fulfill({ json: { userId: "opening-owner", businessId: "opening-business", businessName: "Opening E2E", role: "owner", onboardingRequired: false, workspaceTourSeen: true, activeBranchId: null, activeBranchName: null } }));
  await page.route("**/api/v1/branches", async (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/v1/auth/csrf", async (route) => route.fulfill({ json: { csrfToken: "opening-csrf" } }));
  await page.route("**/api/v1/accounting/accounts", async (route) => route.fulfill({ json: [
    { id: "cash", code: "1000", name: "Cash on Hand", type: "asset", isActive: true },
    { id: "ap", code: "2000", name: "Accounts Payable", type: "liability", isActive: true },
    { id: "equity", code: "3000", name: "Retained Earnings", type: "equity", isActive: true },
  ] }));
  await page.route("**/api/v1/accounting/activation", async (route) => route.fulfill({ json: { status, accountingStartAt: null, openingEntryId, latestBackfillRun: null, backfillIssues: [] } }));
  await page.route("**/api/v1/accounting/activation/opening-balance/preview", async (route) => {
    const body = route.request().postDataJSON() as { lines: Array<{ accountCode: string; debitMinor: number; creditMinor: number }> };
    expect(body.lines).toEqual([{ accountCode: "1000", debitMinor: 10_000, creditMinor: 0 }]);
    await route.fulfill({ json: { draft: { lines: [{ accountCode: "1000", debitMinor: 10_000, creditMinor: 0 }, { accountCode: "3000", debitMinor: 0, creditMinor: 10_000, memo: "Opening retained earnings offset" }] }, totals: { debitMinor: 10_000, creditMinor: 10_000 } } });
  });
  await page.route("**/api/v1/accounting/activation/opening-balance", async (route) => {
    status = "REVIEW";
    openingEntryId = "opening-e2e";
    await route.fulfill({ status: 201, json: { activation: { status, accountingStartAt: "2026-01-01T00:00:00.000Z", openingEntryId }, entry: { id: openingEntryId } } });
  });

  const accounting = new AccountingPage(page);
  await accounting.goto();
  await page.getByRole("button", { name: "Add account line" }).click();
  await expect(page.getByLabel("Opening account 2")).toBeVisible();
  await page.getByRole("button", { name: "Remove opening line 2" }).click();
  await expect(page.getByLabel("Opening account 2")).toHaveCount(0);
  await accounting.previewOpeningBalance("2026-01-01", "100.00");
  await accounting.confirmOpeningBalance();
});

test("owner sees unresolved legacy inventory costs and a fail-closed backfill pause", async ({ page }) => {
  let run: { id: string; status: string; cursor: { family: string; afterId: string | null }; processedCount: number; skippedCount: number } | null = null;
  let issues: Array<{ reason: string }> = [];
  await page.route("**/api/v1/me", async (route) => route.fulfill({ json: { userId: "backfill-owner", businessId: "backfill-business", businessName: "Backfill E2E", role: "owner", onboardingRequired: false, workspaceTourSeen: true, activeBranchId: null, activeBranchName: null } }));
  await page.route("**/api/v1/branches", async (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/v1/auth/csrf", async (route) => route.fulfill({ json: { csrfToken: "backfill-csrf" } }));
  await page.route("**/api/v1/accounting/accounts", async (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/accounting/activation", async (route) => route.fulfill({ json: {
    status: run ? "BACKFILLING" : "NOT_STARTED", accountingStartAt: null, openingEntryId: null,
    latestBackfillRun: run, backfillIssues: issues,
  } }));
  await page.route("**/api/v1/accounting/activation/backfill", async (route) => {
    run = { id: "backfill-e2e", status: "RUNNING", cursor: { family: "sales", afterId: null }, processedCount: 0, skippedCount: 0 };
    await route.fulfill({ status: 202, json: run });
  });
  await page.route("**/api/v1/accounting/activation/backfill/backfill-e2e/run", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ expectedCursor: { family: "sales", afterId: null } });
    run = { id: "backfill-e2e", status: "PAUSED", cursor: { family: "remaining", afterId: null }, processedCount: 4, skippedCount: 2 };
    issues = [{ reason: "historical_movement_cost_unavailable" }, { reason: "standalone_value_adjustment_counter_account_missing" }];
    await route.fulfill({ json: run });
  });

  const accounting = new AccountingPage(page);
  await accounting.goto();
  await accounting.startBackfill();
  await accounting.expectBackfillPausedForUnresolvedCosts();
});
