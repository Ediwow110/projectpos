import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasInventoryWorkbench } from "./AtlasInventoryWorkbench";

describe("Atlas V4 inventory workbench", () => {
  it("shows actual visible low-stock and out-of-stock items with authorized task links", () => {
    const html = renderToStaticMarkup(
      <AtlasInventoryWorkbench branchName="QA Main"
        items={[
          { productId: "milk", productName: "QA Milk", qtyOnHand: 2, reorderLevel: 5 },
          { productId: "sugar", productName: "QA Sugar", qtyOnHand: 0, reorderLevel: 5 },
          { productId: "bread", productName: "QA Bread", qtyOnHand: 10, reorderLevel: 5 },
        ]}
        total={18} />,
    );
    expect(html).toContain('data-ui="atlas-inventory-workbench"');
    expect(html).toContain("Inventory workbench");
    expect(html).toContain("Stock attention for QA Main.");
    expect(html).toContain("Low stock (visible)");
    expect(html).toContain("Out of stock (visible)");
    expect(html).toContain("QA Milk");
    expect(html).toContain("QA Sugar");
    expect(html).not.toContain("QA Bread</span>");
    expect(html).toContain('href="/inventory/milk"');
    expect(html).toContain('href="/inventory/counts"');
    expect(html).toContain('href="/inventory/replenishment"');
    expect(html).toContain('href="/inventory/access"');
    expect(html).toContain("3 of 18 products on the current query page");
  });

  it("does not invent tasks or total counts when there are no stock alerts", () => {
    const html = renderToStaticMarkup(<AtlasInventoryWorkbench branchName={null} items={[]} total={0} />);
    expect(html).toContain("No low or out-of-stock products on this page.");
    expect(html).toContain("0 of 0 products");
    expect(html).not.toContain("7 low-stock");
    expect(html).not.toContain("3 incoming");
  });
});
