import { expect, test } from "@playwright/test";

import { API, apiAuthedContext, createCounterWithOpenShift, registerOperationalBusiness } from "./helpers";

const money = (minor: number): string => (minor / 100).toFixed(2);

test("a closed shift can be explained with an audited correction from its report", async ({ page, request }) => {
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Cash Control Owner",
    email: "shift-corrections-owner@example.com",
    password,
    businessName: "Correction Store",
  });
  const auth = await apiAuthedContext(request, email, password, page);

  await createCounterWithOpenShift(page, "Correction Till");

  const openList = await request.get(`${API}/api/v1/shifts?status=OPEN&limit=50`, { headers: auth.headers });
  expect(openList.ok()).toBe(true);
  const shiftId = ((await openList.json()).items as { id: string }[])[0]?.id;
  expect(shiftId).toBeTruthy();

  const openedReport = await request.get(`${API}/api/v1/shifts/${shiftId}`, { headers: auth.headers });
  expect(openedReport.ok()).toBe(true);
  const expectedCashMinor = ((await openedReport.json()).components as { expectedCash: number }).expectedCash;

  const closed = await request.post(`${API}/api/v1/shifts/${shiftId}/close`, {
    headers: auth.headers,
    data: { countedCashMinor: expectedCashMinor },
  });
  expect(closed.ok()).toBe(true);

  await page.goto(`/shifts/${shiftId}`);
  await expect(page.getByText("No corrections recorded.")).toBeVisible();

  // A zero correction cannot explain a variance: it is refused before the POST,
  // so the audit trail never holds a no-op row.
  await page.getByPlaceholder("-45.30").fill("0");
  await page.getByPlaceholder("Counted float short after till audit").fill("Till audit no-op");
  await page.getByRole("button", { name: "Record correction" }).click();
  await expect(page.getByText("Enter a non-zero amount.")).toBeVisible();
  await expect(page.getByText("Till audit no-op")).toHaveCount(0);

  await page.getByPlaceholder("-45.30").fill("-12.34");
  await page.getByPlaceholder("Counted float short after till audit").fill("Till audit found the float short");
  const correctionResponse = page.waitForResponse(
    (response) => response.url().includes(`/shifts/${shiftId}/corrections`) && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Record correction" }).click();
  const created = await correctionResponse;
  expect(created.status(), await created.text()).toBe(201);

  const recordedRow = page.getByRole("row").filter({ hasText: "Till audit found the float short" });
  await expect(recordedRow).toContainText(money(-1234));

  // The corrected figure is the server's, so the page must agree with the report API.
  const afterCorrection = await request.get(`${API}/api/v1/shifts/${shiftId}`, { headers: auth.headers });
  const corrected = (await afterCorrection.json()).correctedExpectedCash as number | null;
  expect(corrected).toBe(expectedCashMinor - 1234);
  await expect(page.getByText(`Corrected expected cash ${money(corrected as number)}`)).toBeVisible();

  // The closed shift itself stays immutable: the correction is appended, not merged.
  const shiftAfter = await request.get(`${API}/api/v1/shifts/${shiftId}`, { headers: auth.headers });
  const shiftBody = await shiftAfter.json();
  expect(shiftBody.shift.status).toBe("CLOSED");
  expect(shiftBody.components.expectedCash).toBe(expectedCashMinor);
  expect((shiftBody.corrections as unknown[]).length).toBe(1);
});
