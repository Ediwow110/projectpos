import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, confirmPosQuantity, registerOperationalBusiness, seedProduct } from "./helpers";

test("H5 cashier product grid and cart display only real catalog photos", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const email = await registerOperationalBusiness(page, {
    ownerName: "H5 Media QA",
    email: `h5-media-pos-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "H5 Media Display QA",
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  const id = await seedProduct(request, headers, {
    name: "H5 Photo Milk", priceMinor: 13500, stock: 8,
  });
  const imageUrl = "https://images.example.test/h5-milk.webp";
  const updated = await request.patch(`${API}/api/v1/products/${id}`, {
    headers, data: { imageUrl },
  });
  expect(updated.ok()).toBe(true);

  await page.route(imageUrl, async (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC", "base64"),
  }));
  await page.goto("/pos");
  const tile = page.getByRole("button", { name: "H5 Photo Milk ₱135.00" });
  await expect(tile).toBeVisible();
  await expect(tile.locator("img")).toHaveAttribute("src", imageUrl);
  await tile.click();
  await confirmPosQuantity(page);
  await expect(page.getByRole("complementary", { name: "Cart" }).locator("img"))
    .toHaveAttribute("src", imageUrl);
});
