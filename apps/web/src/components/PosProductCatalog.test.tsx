import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosProductCatalog } from "./PosProductCatalog";

describe("POS product catalog", () => {
  it("renders register selection, category tabs, products, and selected state", () => {
    const html = renderToStaticMarkup(
      <PosProductCatalog
        registerId="r1"
        registers={[{ id: "r1", name: "Counter 1", isActive: true }]}
        query="co"
        activeCategoryId="c1"
        categories={[{ id: "c1", name: "Drinks", isActive: true }]}
        products={[{ id: "p1", name: "Coffee", sku: "CF", categoryId: "c1", priceMinor: 2500, isActive: true }]}
        selectedProductIds={new Set(["p1"])}
        loading={false}
        offline={false}
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
  });
});
