import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PosProductCatalog } from "./PosProductCatalog";
import type { PosProduct } from "../lib/pos-sale-model";

const base = {
  registerId: "",
  registers: [],
  query: "",
  activeCategoryId: "",
  categories: [],
  selectedProductIds: new Set<string>(),
  loading: false,
  offline: false,
  saleLocked: false,
  catalogAt: null,
  connectivityBanner: null,
  onRegisterChange: () => undefined,
  onQueryChange: () => undefined,
  onSearch: () => undefined,
  onCategoryChange: () => undefined,
  onAddProduct: () => undefined,
  onAssignCustomer: () => undefined,
};

function render(imageUrl: string | null): string {
  const product: PosProduct = {
    id: "photo-p1",
    name: "Oat Milk",
    sku: "OM",
    categoryId: null,
    priceMinor: 13500,
    isActive: true,
    imageUrl,
  };
  return renderToStaticMarkup(<PosProductCatalog {...base} products={[product]} />);
}

describe("H5 product photo display integration", () => {
  it("shows a real owner image inside the cashier product tile", () => {
    const html = render("https://images.example.test/oat-milk.webp");
    expect(html).toContain('src="https://images.example.test/oat-milk.webp"');
    expect(html).toContain("Oat Milk");
  });

  it("does not render unsafe image URLs or invent sample product images", () => {
    expect(render(null)).not.toContain("<img");
    expect(render("javascript:alert(1)")).not.toContain("<img");
  });
});
