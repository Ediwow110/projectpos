import { expect, test } from "@playwright/test";
import { PayablesPage } from "./pages/PayablesPage";

test("owner reviews supplier bills after posted return credits", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => route.fulfill({ json: {
    userId: "e2e-owner", businessId: "e2e-business", businessName: "Payables E2E", role: "owner",
    onboardingRequired: false, workspaceTourSeen: true, activeBranchId: null, activeBranchName: null,
  } }));
  await page.route("**/api/v1/branches", async (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/v1/payables/bills", async (route) => route.fulfill({ json: { items: [{
    id: "bill-1", supplierId: "supplier-1", supplierName: "Roaster", invoiceNumber: "INV-100", invoiceDate: "2026-10-10T00:00:00.000Z",
    dueDate: null, currency: "PHP", status: "PARTIALLY_PAID", version: 2, invoiceAmountMinor: 30000,
    nonStockChargeMinor: 0, paidMinor: 10000, creditMinor: 5000, openBalanceMinor: 15000,
  }] } }));
  await page.route("**/api/v1/payables/bills/bill-1", async (route) => route.fulfill({ json: {
    bill: { id: "bill-1", supplierId: "supplier-1", supplierName: "Roaster", invoiceNumber: "INV-100", invoiceDate: "2026-10-10T00:00:00.000Z", dueDate: null, currency: "PHP", status: "PARTIALLY_PAID", version: 2, invoiceAmountMinor: 30000, nonStockChargeMinor: 0, paidMinor: 10000, creditMinor: 5000, openBalanceMinor: 15000 },
    allocations: [{ id: "allocation-1", receiptLineId: "receipt-line-1", quantity: 3, unitInvoiceCostMinor: 10000, invoiceAmountMinor: 30000, receiptCostMinorSnapshot: 27000 }],
    payments: [{ id: "payment-1", amountMinor: 10000, method: "bank_transfer", paidAt: "2026-10-10T12:00:00.000Z", reference: "BANK-1" }],
    credits: [{ id: "credit-1", creditNumber: "CN-1", amountMinor: 5000 }],
  } }));

  const payables = new PayablesPage(page);
  await payables.goto();
  await payables.expectBillAndCreditBalance();
  await page.getByRole("button", { name: "View INV-100 details" }).click();
  await payables.expectBillDetail();
});

test("owner creates multi-line receipt-matched bill with price variance preview", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => route.fulfill({ json: { userId: "e2e-owner", businessId: "e2e-business", businessName: "Payables E2E", role: "owner", onboardingRequired: false, workspaceTourSeen: true, activeBranchId: null, activeBranchName: null } }));
  await page.route("**/api/v1/payables/bills", async (route) => route.request().method() === "GET" ? route.fulfill({ json: { items: [] } }) : route.fulfill({ status: 201, json: { bill: { id: "draft-1" }, replayed: false } }));
  await page.route("**/api/v1/suppliers?**", async (route) => route.fulfill({ json: { items: [{ id: "supplier-1", name: "Roaster", isActive: true }] } }));
  await page.route("**/api/v1/purchase-orders?**", async (route) => route.fulfill({ json: { items: [{ id: "order-1", supplierId: "supplier-1", branchId: null, status: "RECEIVED", poNumber: "PO-1" }] } }));
  await page.route("**/api/v1/purchase-orders/order-1/receipts", async (route) => route.fulfill({ json: { items: [{ id: "receipt-1", status: "POSTED", lines: [{ id: "receipt-line-1", quantityReceived: 4, unitCostMinorSnapshot: 12500, productNameSnapshot: "Coffee beans" }, { id: "receipt-line-2", quantityReceived: 3, unitCostMinorSnapshot: 5000, productNameSnapshot: "Tea leaves" }] }] } }));
  await page.route("**/api/v1/auth/csrf", async (route) => route.fulfill({ json: { csrfToken: "e2e-csrf" } }));
  let postedBody: { invoiceAmountMinor: number; allocations: unknown[] } | null = null;
  await page.route("**/api/v1/payables/bills", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [] } });
    postedBody = route.request().postDataJSON() as { invoiceAmountMinor: number; allocations: unknown[] };
    return route.fulfill({ status: 201, json: { bill: { id: "draft-1" }, replayed: false } });
  });
  const payables = new PayablesPage(page);
  await payables.goto();
  await page.getByRole("button", { name: "Create bill draft" }).click();
  await page.getByRole("combobox", { name: "Supplier" }).selectOption("supplier-1");
  await page.getByRole("combobox", { name: "Received item" }).selectOption("receipt-line-1");
  await page.getByRole("spinbutton", { name: "Unit invoice cost" }).fill("130.00");
  await page.getByRole("button", { name: "Add receipt line" }).click();
  await expect(page.getByText(/variance \+₱5\.00/)).toBeVisible();
  await page.getByRole("combobox", { name: "Received item" }).selectOption("receipt-line-2");
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
  await page.getByRole("spinbutton", { name: "Unit invoice cost" }).fill("60.00");
  await page.getByRole("button", { name: "Add receipt line" }).click();
  await expect(page.getByText(/variance \+₱20\.00/)).toBeVisible();
  await page.getByRole("textbox", { name: "Invoice number" }).fill("INV-200");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toContainText("Bill draft created");
  expect(postedBody?.invoiceAmountMinor).toBe(25_000);
  expect(postedBody?.allocations).toHaveLength(2);
});

test("owner applies a posted supplier credit to an open bill", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => route.fulfill({ json: { userId: "e2e-owner", businessId: "e2e-business", businessName: "Payables E2E", role: "owner", onboardingRequired: false, workspaceTourSeen: true, activeBranchId: null, activeBranchName: null } }));
  let applied = false;
  await page.route("**/api/v1/payables/bills", async (route) => route.fulfill({ json: { items: [{
    id: "bill-credit", supplierId: "supplier-credit", supplierName: "Roaster", invoiceNumber: "INV-300", invoiceDate: "2026-10-10T00:00:00.000Z",
    dueDate: null, currency: "PHP", status: "POSTED", version: 1, invoiceAmountMinor: 30000,
    nonStockChargeMinor: 0, paidMinor: 0, creditMinor: applied ? 10000 : 0, openBalanceMinor: applied ? 20000 : 30000,
  }] } }));
  await page.route("**/api/v1/payables/credits", async (route) => route.fulfill({ json: { items: applied ? [] : [{ id: "credit-1", supplierId: "supplier-credit", creditNumber: "CN-1", amountMinor: 10000 }] } }));
  await page.route("**/api/v1/payables/credits/credit-1/apply", async (route) => { applied = true; return route.fulfill({ json: { credit: { id: "credit-1", billId: "bill-credit", status: "APPLIED" } } }); });
  await page.route("**/api/v1/auth/csrf", async (route) => route.fulfill({ json: { csrfToken: "credit-csrf" } }));

  const payables = new PayablesPage(page);
  await payables.goto();
  await page.getByRole("button", { name: "Apply credit", exact: true }).first().click();
  await page.getByRole("combobox", { name: "Available supplier credit" }).selectOption("credit-1");
  await page.getByRole("button", { name: "Apply credit", exact: true }).last().click();
  await expect(page.getByRole("status")).toContainText("Supplier credit applied");
});
