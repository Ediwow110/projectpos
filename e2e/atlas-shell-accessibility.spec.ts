import { expect, test, type Page } from "@playwright/test";
import { apiAuthedContext, createStaffMember, registerOperationalBusiness, signIn } from "./helpers";

/**
 * The rendered counterpart to apps/web/src/lib/atlas-shell-a11y-contract.test.ts.
 * The source contract pins the change; this measures the result in a real
 * browser, which is where the D7 findings were found in the first place.
 */

const SURFACES = [
  { selector: "[data-ui='shell-header']", label: "shell header" },
  { selector: "nav[aria-label='Primary navigation']", label: "primary navigation" },
  { selector: "[data-ui='atlas-workspace-destinations']", label: "workspace destinations" },
];

type Measurement = {
  text: string;
  fontSize: number;
  ratio: number;
  color: string;
  background: string;
};

async function measure(page: Page, selector: string): Promise<{ text: Measurement[]; controls: Array<{ label: string; width: number; height: number }> }> {
  return page.evaluate((target) => {
    const parse = (value: string): number[] | null => {
      const parts = (value || "").match(/[\d.]+/g);
      if (!parts) return null;
      const numbers = parts.map(Number);
      return [numbers[0]!, numbers[1]!, numbers[2]!, numbers.length > 3 ? numbers[3]! : 1];
    };
    const channel = (value: number): number => {
      const ratio = value / 255;
      return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]: number[]): number =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const opaqueBackground = (element: Element): number[] => {
      let node: Element | null = element;
      while (node) {
        const parsed = parse(getComputedStyle(node).backgroundColor);
        if (parsed && parsed[3]! >= 0.99) return parsed;
        node = node.parentElement;
      }
      for (const fallback of [document.body, document.documentElement]) {
        const parsed = parse(getComputedStyle(fallback).backgroundColor);
        if (parsed && parsed[3]! >= 0.99) return parsed;
      }
      return [255, 255, 255, 1];
    };
    const root = document.querySelector(target);
    if (!root) return { text: [], controls: [] };

    const text: Array<{ text: string; fontSize: number; ratio: number; color: string; background: string }> = [];
    root.querySelectorAll("*").forEach((element) => {
      if (element.offsetParent === null) return;
      // A decorative glyph carries no information, so its size is not a text size.
      if (element.closest('[aria-hidden="true"]')) return;
      const own = Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent?.trim() ?? "")
        .join("")
        .trim();
      if (!own) return;
      const style = getComputedStyle(element);
      const foreground = parse(style.color);
      if (!foreground) return;
      const background = opaqueBackground(element);
      const first = luminance(foreground.slice(0, 3));
      const second = luminance(background.slice(0, 3));
      const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
      text.push({
        text: own.slice(0, 40),
        fontSize: Number.parseFloat(style.fontSize),
        ratio: Math.round(ratio * 100) / 100,
        color: style.color,
        background: `rgb(${background.slice(0, 3).join(",")})`,
      });
    });

    const controls: Array<{ label: string; width: number; height: number }> = [];
    root.querySelectorAll("a, button, select, input, textarea, [role='button'], [role='link']").forEach((element) => {
      if (element.offsetParent === null) return;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const label = (element.getAttribute("aria-label") || element.textContent || element.tagName).trim().slice(0, 30);
      controls.push({ label, width: Math.round(box.width), height: Math.round(box.height) });
    });

    return { text, controls };
  }, selector);
}

test("the workspace shell and the sign-in page are readable and reachable", async ({ page, request, viewport }) => {
  test.setTimeout(300_000);

  // 1. The public sign-in page.
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const signInSurface = await measure(page, "main");
  const signInText = signInSurface.text;
  expect(signInText.length, "the sign-in page must expose measurable text").toBeGreaterThan(8);
  const smallSignIn = signInText.filter((item) => item.fontSize < 12);
  expect(smallSignIn, `sign-in text below 12px: ${JSON.stringify(smallSignIn)}`).toEqual([]);
  const lowSignIn = signInText.filter((item) => item.ratio < 4.5);
  expect(lowSignIn, `sign-in text below 4.5:1: ${JSON.stringify(lowSignIn)}`).toEqual([]);
  const toggle = signInSurface.controls.find((control) => /^show$/i.test(control.label));
  expect(toggle, "the password visibility toggle must be present").toBeTruthy();
  expect(toggle!.height, "the password visibility toggle must be at least 24px tall").toBeGreaterThanOrEqual(24);
  expect(toggle!.width, "the password visibility toggle must be at least 24px wide").toBeGreaterThanOrEqual(24);

  // 2. The signed-in workspace shell.
  const stamp = Date.now();
  const password = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "A11y Owner",
    email: `a11y-owner-${stamp}@example.com`,
    password,
    businessName: "A11y QA",
  });
  const { headers } = await apiAuthedContext(request, ownerEmail, password, page);
  const inventoryEmail = `a11y-inventory-${stamp}@example.com`;
  const inventory = await createStaffMember(request, headers, {
    email: inventoryEmail, name: "A11y Inventory", role: "inventory",
  });

  await signIn(page, ownerEmail, password);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // The workspace destinations are rendered in the desktop rail and inside
  // the drawer on narrow layouts, so the surface to measure depends on the
  // viewport: on the desktop rail the disclosure is closed by default and
  // must be opened; on narrow layouts the drawer itself must be opened.
  const narrow = (viewport?.width ?? 1440) < 1280;
  let measuredText = 0;
  let measuredControls = 0;

  const surfacesToMeasure = (selector: string) => measure(page, selector);

  if (narrow) {
    const menu = page.getByRole("button", { name: "Open workspace menu" }).first();
    if (await menu.isVisible()) {
      await menu.click();
      await page.waitForTimeout(900);
    }
  }

  const summary = page.locator("[data-ui='atlas-workspace-destinations'] summary").first();
  if (await summary.isVisible()) {
    await summary.click();
    await page.waitForTimeout(600);
  }

  for (const surface of SURFACES) {
    if ((await page.locator(surface.selector).count()) === 0) continue;
    const measured = await surfacesToMeasure(surface.selector);
    const small = measured.text.filter((item) => item.fontSize < 12);
    expect(small, `${surface.label}: text below 12px: ${JSON.stringify(small)}`).toEqual([]);
    const low = measured.text.filter((item) => item.ratio < 4.5);
    expect(low, `${surface.label}: text below 4.5:1: ${JSON.stringify(low)}`).toEqual([]);
    const tiny = measured.controls.filter((control) => control.width < 24 || control.height < 24);
    expect(tiny, `${surface.label}: controls below 24px: ${JSON.stringify(tiny)}`).toEqual([]);
    measuredText += measured.text.length;
    measuredControls += measured.controls.length;
  }
  // A gate that measured nothing must not pass. The desktop shell carries
  // more chrome than the drawer, so the floor differs by layout.
  expect(measuredText, "the shell must expose measurable text").toBeGreaterThan(narrow ? 4 : 15);
  expect(measuredControls, "the shell must expose measurable controls").toBeGreaterThan(narrow ? 1 : 4);

  // 3. The 404 page must offer a way back.
  await page.goto("/definitely-not-a-route", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const recovery = page.getByRole("link", { name: /back to workspace/i });
  await expect(recovery).toBeVisible();
  const recoveryBox = await recovery.boundingBox();
  expect(recoveryBox!.height, "the recovery link must be at least 24px tall").toBeGreaterThanOrEqual(24);

  // 4. The inventory surfaces must each carry exactly one h1.
  await signIn(page, inventoryEmail, inventory.tempPassword);
  for (const path of ["/inventory", "/inventory/access"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const headings = await page.evaluate(() =>
      Array.from(document.querySelectorAll("h1"))
        .filter((element) => element.offsetParent !== null)
        .map((element) => element.textContent?.trim().slice(0, 40) ?? ""),
    );
    expect(headings, `${path} must carry exactly one visible h1`).toHaveLength(1);
  }
});
