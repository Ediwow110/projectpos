import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("premium POS shell", () => {
  it("uses a full app shell with header, sidebar navigation, main, footer, and POS tablet chrome", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");
    const cartSource = readFileSync(resolve(process.cwd(), "src/components/PosCartPanel.tsx"), "utf8");
    const shellSource = readFileSync(resolve(process.cwd(), "src/components/AppShell.tsx"), "utf8");

    expect(posSource).toContain("<AppShell");
    expect(posSource).toContain("posMode");
    expect(posSource).not.toContain("Dark topbar");
    expect(cartSource).toContain("lg:max-xl:hidden");
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
    const paymentSource = readFileSync(resolve(process.cwd(), "src/components/PosPaymentWorkspace.tsx"), "utf8");

    expect(paymentSource).toContain('data-ui="payment-workspace"');
    expect(paymentSource).toContain("xl:grid-cols-[650px_562px]");
    expect(paymentSource).toContain("Sale summary");
    expect(paymentSource).toContain("Take payment");
  });

  it("keeps the normal online POS canvas free of a redundant connectivity banner", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");

    expect(posSource).toContain('connectivityBanner={offline && store ? <div className="mt-3"><ConnectivityBanner store={store} /></div> : null}');
  });

  it("treats customer assignment as a secondary POS action instead of permanent canvas chrome", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");
    const productSource = readFileSync(resolve(process.cwd(), "src/components/PosProductCatalog.tsx"), "utf8");
    const customerSource = readFileSync(resolve(process.cwd(), "src/components/PosCustomerDialog.tsx"), "utf8");
    const responsiveCartSource = readFileSync(resolve(process.cwd(), "src/components/PosResponsiveCart.tsx"), "utf8");

    expect(posSource).toContain("showCustomer");
    expect(customerSource).toContain('aria-label="Customer assignment"');
    expect(responsiveCartSource).toContain("Add customer");
    expect(productSource).toContain("xl:overflow-y-auto");
    expect(productSource).toContain("content-start");
    expect(posSource).not.toContain("Customer strip");
  });

  it("matches the canonical 1024px tablet offsets and product-grid geometry", () => {
    const productSource = readFileSync(resolve(process.cwd(), "src/components/PosProductCatalog.tsx"), "utf8");
    const shellSource = readFileSync(resolve(process.cwd(), "src/components/AppShell.tsx"), "utf8");

    expect(shellSource).toContain('posMode ? "min-h-[62px]" : "min-h-[60px]"');
    expect(productSource).toContain("lg:max-xl:px-7 lg:max-xl:pb-7 lg:max-xl:pt-6");
    expect(productSource).toContain("lg:max-xl:mt-[18px]");
    expect(productSource).toContain("lg:max-xl:grid-cols-[repeat(3,280px)]");
    // The xl catalog reflows 4-to-3 columns so the two-pane grid never
    // overflows the content column at 1280-1440px viewports (see
    // e2e/pos-responsive.spec.ts for the native-click regression).
    expect(productSource).toContain("xl:grid-cols-[repeat(auto-fill,minmax(215px,1fr))]");
    expect(productSource).toContain("xl:gap-3");
  });

  it("keeps the xl two-pane grid fluid so the cart column never overflows", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");

    expect(posSource).toContain("xl:grid-cols-[minmax(0,1fr)_456px]");
    expect(posSource).not.toContain('(showPay ? "xl:hidden"');
    expect(posSource).toContain("atlasPos");
    expect(posSource).toContain("atlasV4");
    expect(posSource).toContain("bg-[#f7f8f5]");
    expect(readFileSync(resolve(process.cwd(), "src/components/AtlasPosRail.tsx"), "utf8")).toContain("bg-[#252e2b]");
    expect(posSource).not.toContain("xl:grid-cols-[760px_452px]");
  });

  it("uses API-backed category tabs instead of hardcoded category labels", () => {
    const posSource = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");
    const dataSource = readFileSync(resolve(process.cwd(), "src/lib/use-pos-data.ts"), "utf8");

    expect(dataSource).toContain('queryKey: ["pos-categories"]');
    expect(dataSource).toContain('apiFetch<{ items: Array<{ id: string; name: string; isActive: boolean }> }>("/api/v1/categories")');
    expect(posSource).toContain("activeCategoryId");
    expect(dataSource).toContain("categoryId: activeCategoryId || undefined");
    expect(posSource).toContain("categoriesQuery.data?.items");
    expect(posSource).not.toContain(">Beverages<");
    expect(posSource).not.toContain(">Snacks<");
  });

  it("uses the canonical coral add affordance and selected product visual treatment", () => {
    const productSource = readFileSync(resolve(process.cwd(), "src/components/PosProductCatalog.tsx"), "utf8");

    expect(productSource).toMatch(/data-ui="product-add"[^>]+bg-\[#f35d3f\]/s);
    expect(productSource).toContain('selected ? "bg-[#4a2118]" : productTileClass(product.name)');
  });

  it("anchors the 1024px tablet cart tray to the canonical Figma action positions", () => {
    const responsiveCartSource = readFileSync(resolve(process.cwd(), "src/components/PosResponsiveCart.tsx"), "utf8");
    const productSource = readFileSync(resolve(process.cwd(), "src/components/PosProductCatalog.tsx"), "utf8");

    expect(responsiveCartSource).toContain('aria-label="Tablet cart"');
    expect(responsiveCartSource).toContain("lg:max-xl:block");
    expect(responsiveCartSource).toContain("absolute left-7 top-6");
    expect(responsiveCartSource).toContain("absolute left-7 top-[88px] h-12 w-[180px]");
    expect(responsiveCartSource).toContain("absolute right-[221px] top-6 w-[123px] text-left");
    expect(responsiveCartSource).toContain("absolute right-7 top-20 h-14 w-[290px]");
    expect(productSource).toContain("text-white/40 xl:block");
  });

  it("keeps the desktop current-sale rail spatially stable like the Figma cart panel", () => {
    const cartSource = readFileSync(resolve(process.cwd(), "src/components/PosCartPanel.tsx"), "utf8");

    expect(cartSource).toContain("xl:h-[244px]");
    expect(cartSource).toContain('aria-label="Assign customer to sale"');
    expect(cartSource).toContain("grid grid-cols-4 gap-2");
    expect(cartSource).toContain("Clear sale");
    expect(cartSource).toContain("Totals are server-validated before commit");
  });

  it("uses Atlas V4's compact desktop register rail and light workspace", () => {
    const shell = readFileSync(resolve(process.cwd(), "src/components/AppShell.tsx"), "utf8");
    const pos = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");
    const rail = readFileSync(resolve(process.cwd(), "src/components/AtlasPosRail.tsx"), "utf8");
    const catalog = readFileSync(resolve(process.cwd(), "src/components/PosProductCatalog.tsx"), "utf8");
    const cart = readFileSync(resolve(process.cwd(), "src/components/PosCartPanel.tsx"), "utf8");
    expect(shell).toContain("xl:grid-cols-[78px_minmax(0,1fr)]");
    expect(shell).toContain("<AtlasPosRail");
    expect(shell).toContain('data-ui="atlas-pos-title"');
    expect(rail).toContain("bg-[#252e2b]");
    expect(pos).toContain("bg-[#f7f8f5]");
    expect(catalog).toContain('data-ui="atlas-pos-products"');
    expect(cart).toContain('data-ui="atlas-pos-cart"');
  });
});
