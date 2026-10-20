import { expect, test } from "@playwright/test";

test("frontend CSP is enforced without blocking the Next.js runtime", async ({ page }) => {
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/content security policy|refused to (?:connect|execute|load|apply)/i.test(text)) {
      cspViolations.push(text);
    }
  });

  const response = await page.goto("/login");
  expect(response).not.toBeNull();

  const csp = response!.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("script-src-attr 'none'");

  await expect(page.getByRole("heading", { name: "Sign in to NexPOS" })).toBeVisible();
  await page.waitForTimeout(250);
  expect(cspViolations).toEqual([]);
});
