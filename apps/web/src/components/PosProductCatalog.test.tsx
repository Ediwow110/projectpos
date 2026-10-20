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
});
