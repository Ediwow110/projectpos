import { expect, test } from "@playwright/test";
import {
  apiAuthedContext,
  clickPosPay,
  confirmPosQuantity,
  registerOperationalBusiness,
  seedProduct,
} from "./helpers";

const SLOT_PREFIX = "nexpos:pos-attempt:";

function readAttemptSlot(page: import("@playwright/test").Page) {
  return page.evaluate((prefix) => {
    const slot = Object.keys(window.localStorage).find((name) => name.startsWith(prefix));
    return slot ? { slot, key: window.localStorage.getItem(slot) } : null;
  }, SLOT_PREFIX);
}

test("an attempt the server could not answer keeps its pointer across a reload", async ({
  page,
  request,
}, testInfo) => {
  // The attempt slot drives the atlas payment surfaces; the mobile shells run
  // the same controller through a different payment workspace.
  test.skip(testInfo.project.name.startsWith("mobile"), "atlas-surface assertion");
  test.setTimeout(180_000);

  const stamp = Date.now();
  const email = `attempt-${stamp}@example.com`;
  const password = "correct-horse-12";
  await registerOperationalBusiness(page, {
    ownerName: "Attempt Recovery QA",
    email,
    password,
    businessName: `Attempt Recovery Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  await seedProduct(request, headers, { name: "Attempt Cola", priceMinor: 2500, stock: 10 });

  await page.goto("/registers");
  await page.getByRole("button", { name: "+ Create register", exact: true }).click();
  const registerDialog = page.getByRole("dialog", { name: "Create register" });
  await registerDialog.getByLabel("Register name").fill("Recovery Till");
  await registerDialog.getByRole("button", { name: "Create register", exact: true }).click();
  await expect(page.getByText("Recovery Till")).toBeVisible();

  // A register-tied sale needs the register's shift open before the client
  // reaches the completion request.
  await page.goto("/shifts");
  await page.getByRole("button", { name: "+ Open shift", exact: true }).click();
  const openShiftDialog = page.getByRole("dialog", { name: "Open shift" });
  await openShiftDialog.getByLabel("Register").selectOption({ label: "Recovery Till" });
  await openShiftDialog.getByLabel("Opening float (PHP)").fill("100.00");
  await openShiftDialog.getByRole("button", { name: "Open shift", exact: true }).click();
  await expect(page.getByText("Shift opened.")).toBeVisible();

  const selectRegister = async () => {
    await page.goto("/pos");
    const registers = page.locator(
      'select[aria-label="Register"]:visible, select[aria-label="Mobile register"]:visible',
    );
    await registers.selectOption({ label: "Recovery Till" });
    await expect(registers).not.toHaveValue("");
  };

  await selectRegister();

  // The completion response is lost after the draft is recorded, which is the
  // case the browser slot exists for. The lookup is refused from here on: a
  // server that cannot answer has not said the attempt is absent.
  let completionCalls = 0;
  let attemptCalls = 0;
  await page.route("**/api/v1/sales/complete", async (route) => {
    completionCalls += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "HTTP_ERROR", message: "Request failed." }),
    });
  });
  await page.route("**/api/v1/sales/attempts/**", async (route) => {
    attemptCalls += 1;
    await route.fulfill({ status: 502, contentType: "application/json", body: "{}" });
  });

  await page.getByRole("button", { name: /Attempt Cola ₱25\.00/ }).click();
  await confirmPosQuantity(page);
  await clickPosPay(page, "25.00");
  await page
    .getByRole("dialog", { name: "Payment", exact: true })
    .getByRole("button", { name: "Complete Payment" })
    .click();

  await page.waitForTimeout(3000);
  expect(completionCalls, "the payment must reach the completion request").toBeGreaterThan(0);

  const planted = await readAttemptSlot(page);
  expect(planted?.key, "the lost completion must leave an attempt key in the slot").toBeTruthy();

  // Leave and come back. The register re-binds, the lookup is refused, and the
  // pointer must survive with a second payment blocked.
  await selectRegister();

  // The POS renders the status copy in more than one region across layouts, so
  // require a *visible* instance rather than whichever node resolves first.
  await expect(
    page.getByText(/could not confirm an earlier payment attempt/i).locator("visible=true").first(),
  ).toBeVisible({ timeout: 15_000 });
  expect(attemptCalls, "the re-entered register must ask the server what happened").toBeGreaterThan(0);
  const retained = await readAttemptSlot(page);
  expect(retained?.key, "an unanswerable lookup must not discard the attempt pointer").toBe(planted!.key);
});
