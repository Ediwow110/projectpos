import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ManagerApprovalDialog } from "./ManagerApprovalDialog";

describe("manager approval dialog", () => {
  it("uses the shared modal with masked approval credentials and exact-action guidance", () => {
    const html = renderToStaticMarkup(
      <ManagerApprovalDialog
        open
        permission="inventory.adjust"
        action={{ kind: "inventory_movement", productId: "p1", movementType: "receive", qtyDelta: 4 }}
        description="A manager must authorize this stock movement."
        summary="Coffee · receive · 4 units"
        onApproved={async () => true}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Manager approval required");
    expect(html).toContain("exact action");
    expect(html).toContain("Manager email");
    expect(html).toContain("Approval PIN");
    expect(html).toContain('type="password"');
    expect(html).toContain("Use password instead");
    expect(html).toContain("Coffee · receive · 4 units");
  });
});
