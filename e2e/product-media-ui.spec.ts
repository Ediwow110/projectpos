import { expect, test } from "@playwright/test";
import { apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC", "base64");

test("Atlas V4 owner crop preview, upload, replace and remove UI with isolated media API responses", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const email = await registerOperationalBusiness(page, {
    ownerName: "Media UI QA", email: `media-ui-${stamp}@example.com`,
    password: "correct-horse-12", businessName: "Media UI QA Store",
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  const productId = await seedProduct(request, headers, { name: "Photo Milk", priceMinor: 13500, stock: 10 });
  let latest = { imageUrl: null as string | null, assetId: null as string | null };
  let uploads = 0;
  let removes = 0;
  await page.route("**/api/v1/product-media/capabilities", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ enabled: true, maxSourceBytes: 3 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"] }) });
  });
  await page.route(`**/api/v1/products/${productId}/image`, async (route) => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(latest) });
    if (method === "POST") {
      const body = route.request().postDataBuffer();
      expect(body?.includes(Buffer.from("image/webp"))).toBe(true);
      uploads += 1;
      latest = { imageUrl: `https://example.test/photo-${uploads}.webp`, assetId: `asset-${uploads}` };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(latest) });
    }
    if (method === "DELETE") {
      removes += 1;
      latest = { imageUrl: null, assetId: null };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(latest) });
    }
    return route.abort();
  });
  await page.goto(`/products/${productId}`);
  const panel = page.getByRole("region", { name: "Owner-managed photo" });
  await expect(panel.getByText("Upload photo", { exact: true })).toBeVisible();
  const picker = panel.locator('input[type="file"]');
  await picker.setInputFiles({ name: "milk.png", mimeType: "image/png", buffer: png });
  await expect(panel.getByRole("slider", { name: "Crop zoom" })).toBeVisible();
  await panel.getByRole("slider", { name: "Crop zoom" }).fill("1.5");
  await panel.getByRole("button", { name: "Save cropped photo" }).click();
  await expect(panel.getByRole("status")).toContainText("Product photo saved.");
  expect(uploads).toBe(1);
  await picker.setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: png });
  await panel.getByRole("button", { name: "Save cropped photo" }).click();
  await expect(panel.getByRole("status")).toContainText("Product photo saved.");
  expect(uploads).toBe(2);
  await expect(panel.getByRole("button", { name: "Remove photo" })).toBeVisible();
  await panel.getByRole("button", { name: "Remove photo" }).click();
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(removes).toBe(0);
  await panel.getByRole("button", { name: "Remove photo" }).click();
  await panel.getByRole("button", { name: "Yes, remove" }).click();
  await expect(panel.getByRole("status")).toContainText("Product photo removed.");
  expect(removes).toBe(1);
});
