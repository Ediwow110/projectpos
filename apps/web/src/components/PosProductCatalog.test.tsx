import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosProductCatalog } from "./PosProductCatalog";

describe("POS product catalog", () => {
  it("uses Atlas V4 light product cards and a labeled Set qty affordance", () => {
    const html = renderToStaticMarkup(<PosProductCatalog atlasV4
      registerId="" registers={[]} query="" activeCategoryId="" categories={[]}
      products={[{ id: "p1", name: "Oat milk", sku: "MILK", categoryId: null, priceMinor: 13500, isActive: true }]}
      selectedProductIds={new Set()} loading={false} offline={false} saleLocked={false}
      catalogAt={null} connectivityBanner={null}
      onRegisterChange={() => undefined} onQueryChange={() => undefined}
      onSearch={() => undefined} onCategoryChange={() => undefined}
      onAddProduct={() => undefined} onAssignCustomer={() => undefined}
    />);
    expect(html).toContain('data-ui="atlas-pos-products"');
    expect(html).toContain('bg-[#f7f8f5]');
    expect(html).toContain("Set qty");
    expect(html).toContain("Oat milk");
    expect(html).toContain('aria-label="Oat milk ₱135.00"');
    expect(html).toContain('aria-labelledby="pos-quantity-title"');
  });
  it("renders register selection, category tabs, products, and selected state", () => {
    const html = renderToStaticMarkup(
      <PosProductCatalog
        registerId="r1"
        registers={[{ id: "r1", name: "Counter 1", isActive: true }]}
        query="co"
        activeCategoryId="c1"
        categories={[{ id: "c1", name: "Drinks", isActive: true }]}
        products={[{ id: "p1", name: "Coffee", sku: "CF", categoryId: "c1", priceMinor: 2500, isActive: true, imageUrl: "https://images.example.com/coffee.jpg" }]}
        selectedProductIds={new Set(["p1"])}
        loading={false}
        offline={false}
        saleLocked={false}
        catalogAt={null}
        connectivityBanner={null}
        onRegisterChange={() => undefined}
        onQueryChange={() => undefined}
        onSearch={() => undefined}
        onCategoryChange={() => undefined}
        onAddProduct={() => undefined}
        onAssignCustomer={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Products"');
    expect(html).toContain('aria-label="Mobile register"');
    expect(html).toContain("Coffee");
    expect(html).toContain("Drinks");
    expect(html).toContain("bg-[#4a2118]");
    expect(html).toContain('data-ui="product-add"');
    expect(html).toContain("https://images.example.com/coffee.jpg");
    expect(html).toContain('aria-description="Choose quantity before adding to the sale"');
  });

  it("keeps Atlas V4 category chips on the 44px touch contract", () => {
    const html = renderToStaticMarkup(<PosProductCatalog atlasV4
      registerId="" registers={[]} query="" activeCategoryId="c1"
      categories={[{ id: "c1", name: "Drinks", isActive: true }]}
      products={[]} selectedProductIds={new Set()} loading={false} offline={false} saleLocked={false}
      catalogAt={null} connectivityBanner={null}
      onRegisterChange={() => undefined} onQueryChange={() => undefined}
      onSearch={() => undefined} onCategoryChange={() => undefined}
      onAddProduct={() => undefined} onAssignCustomer={() => undefined}
    />);

    expect(html).toContain("min-h-11 min-w-[112px]");
    expect(html).toContain("ml-auto min-h-11 shrink-0");
    expect(html).not.toMatch(/min-h-\[35px\]|min-h-9\b/);
    // the selected chip still highlights the tapped category, not "All products"
    expect(html).toContain('aria-pressed="true" class="min-h-11 min-w-[112px] shrink-0 rounded-[7px] px-3 text-xs font-medium sm:min-w-[125px] bg-[#202826] text-white"');
  });

  it("raises the legacy Set-qty affordance and clears the near-invisible caption literals", () => {
    const html = renderToStaticMarkup(
      <PosProductCatalog
        registerId="r1"
        registers={[{ id: "r1", name: "Counter 1", isActive: true }]}
        query=""
        activeCategoryId=""
        categories={[{ id: "c1", name: "Drinks", isActive: true }]}
        products={[{ id: "p1", name: "Coffee", sku: "CF", categoryId: "c1", priceMinor: 2500, isActive: true }]}
        selectedProductIds={new Set()}
        loading={false}
        offline={false}
        saleLocked={false}
        catalogAt={null}
        connectivityBanner={null}
        onRegisterChange={() => undefined}
        onQueryChange={() => undefined}
        onSearch={() => undefined}
        onCategoryChange={() => undefined}
        onAddProduct={() => undefined}
        onAssignCustomer={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Set qty for Coffee" class="absolute bottom-2.5 right-2.5 z-10 min-h-11');
    expect(html).not.toContain("xl:min-h-[30px]");
    expect(html).not.toContain("min-h-9 ");
    expect(html).not.toContain("h-[34px]");
    expect(html).toContain('min-h-11 rounded-lg border border-[#e5e9e3] bg-[#eff2ef]');
    expect(html).toContain('aria-label="Mobile register" class="min-h-11 min-w-0');
    // Every foreground, including the aria-hidden search glyph, now uses the
    // text-safe token - so no banned literal remains in this surface at all.
    expect(html.match(/#71807a/g)).toBeNull();
    expect(html.match(/text-white\/35/g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35 xl:text-[var(--color-atlas-muted-strong)]"');
    // the F1 hint sat as white/35 text on a light button; it now uses the text-safe token
    expect(html).toContain('Add customer <span class="font-data text-[var(--color-atlas-muted-strong)]">F1</span>');
  });
});
