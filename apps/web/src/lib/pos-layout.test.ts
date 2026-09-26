import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("premium POS shell", () => {
  it("uses a full app shell with header, sidebar navigation, main, footer, and POS tablet chrome", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");
    const shellSource = readFileSync(resolve(process.cwd(), "src/components/AppShell.tsx"), "utf8");

    expect(posSource).toContain("<AppShell");
    expect(posSource).toContain("posMode");
    expect(posSource).not.toContain("Dark topbar");
    expect(posSource).toContain("lg:max-xl:hidden");
    expect(posSource).toContain("showTabletCart");
    expect(shellSource).toContain('data-ui="shell-header"');
    expect(shellSource).toContain('data-ui="shell-mobile-nav"');
    expect(shellSource).toContain('data-ui="shell-sidebar"');
    expect(shellSource).toContain('data-ui="shell-main"');
    expect(shellSource).toContain('data-ui="shell-footer"');
    expect(shellSource).toContain("xl:grid-cols-[220px_minmax(0,1fr)]");
    expect(shellSource).toContain('aria-label="Primary navigation"');
    expect(shellSource).not.toContain('href: "/billing"');
    expect(shellSource).toContain('data-ui="pos-tablet-header"');
  });

  it("uses the Figma-style dedicated payment workspace on desktop", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");

    expect(posSource).toContain('data-ui="payment-workspace"');
    expect(posSource).toContain("xl:grid-cols-[650px_562px]");
    expect(posSource).toContain("Sale summary");
    expect(posSource).toContain("Take payment");
  });

  it("keeps the normal online POS canvas free of a redundant connectivity banner", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");

    expect(posSource).toContain('offline ? <div className="mt-3"><ConnectivityBanner store={store} /></div> : null');
  });

  it("treats customer assignment as a secondary POS action instead of permanent canvas chrome", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");

    expect(posSource).toContain("showCustomer");
    expect(posSource).toContain('aria-label="Customer assignment"');
    expect(posSource).toContain("Add customer");
    expect(posSource).toContain("xl:overflow-y-auto");
    expect(posSource).toContain("content-start");
    expect(posSource).not.toContain("Customer strip");
  });

  it("matches the canonical 1024px tablet offsets and product-grid geometry", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");
    const shellSource = readFileSync(resolve(process.cwd(), "src/components/AppShell.tsx"), "utf8");

    expect(shellSource).toContain('posMode ? "min-h-[62px]" : "min-h-[60px]"');
    expect(posSource).toContain("lg:max-xl:px-7 lg:max-xl:pb-7 lg:max-xl:pt-6");
    expect(posSource).toContain("lg:max-xl:mt-[18px]");
    expect(posSource).toContain("lg:max-xl:grid-cols-[repeat(3,280px)]");
    expect(posSource).toContain("xl:grid-cols-[repeat(4,176px)]");
    expect(posSource).toContain("xl:gap-2");
  });

  it("uses API-backed category tabs instead of hardcoded category labels", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");

    expect(posSource).toContain('queryKey: ["pos-categories"]');
    expect(posSource).toContain('apiFetch<{ items: CategoryRow[] }>("/api/v1/categories")');
    expect(posSource).toContain("activeCategoryId");
    expect(posSource).toContain("categoryId: activeCategoryId || undefined");
    expect(posSource).toContain("categoriesQuery.data?.items");
    expect(posSource).not.toContain(">Beverages<");
    expect(posSource).not.toContain(">Snacks<");
  });

  it("uses the canonical coral add affordance and selected product visual treatment", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");

    expect(posSource).toMatch(/data-ui="product-add"[^>]+bg-\[#f35d3f\]/s);
    expect(posSource).toContain(
      'cart.some((item) => item.productId === p.id) ? "bg-[#4a2118]" : tileColor(p.name)',
    );
  });

  it("anchors the 1024px tablet cart tray to the canonical Figma action positions", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");

    expect(posSource).toContain('aria-label="Tablet cart"');
    expect(posSource).toContain("lg:max-xl:block");
    expect(posSource).toContain("absolute left-7 top-6");
    expect(posSource).toContain("absolute left-7 top-[88px] h-12 w-[180px]");
    expect(posSource).toContain("absolute right-[221px] top-6 w-[123px] text-left");
    expect(posSource).toContain("absolute right-7 top-20 h-14 w-[290px]");
    expect(posSource).toContain("text-white/40 xl:block");
  });

  it("keeps the desktop current-sale rail spatially stable like the Figma cart panel", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");

    expect(posSource).toContain("xl:h-[244px]");
    expect(posSource).toContain('aria-label="Assign customer to sale"');
    expect(posSource).toContain("grid grid-cols-4 gap-2");
    expect(posSource).toContain("Clear sale");
    expect(posSource).toContain("Totals are server-validated before commit");
  });
});
