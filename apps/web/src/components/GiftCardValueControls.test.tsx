import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GiftCardValueControls } from "./GiftCardValueControls";

Object.assign(globalThis, { React });

function render(props: Partial<React.ComponentProps<typeof GiftCardValueControls>> = {}): string {
  return renderToStaticMarkup(
    <GiftCardValueControls
      cardId="gc_1"
      status="ACTIVE"
      balanceMinor={50_000}
      permissions={["gift_card.manage", "stored_value.adjust"]}
      role="manager"
      onChanged={vi.fn()}
      {...props}
    />,
  );
}

describe("gift-card value controls", () => {
  it("offers a reviewer with the grant a direct adjustment", () => {
    const html = render();
    expect(html).toContain('data-ui="gift-card-adjust-amount"');
    expect(html).toContain("Apply adjustment");
  });

  it("routes a cashier through manager approval instead of applying the change", () => {
    const html = render({ role: "cashier", permissions: [] });
    expect(html).toContain("Request manager review");
    expect(html).not.toContain("Apply adjustment");
  });

  it("tells a reviewer without either path why nothing is offered", () => {
    const html = render({ role: "inventory", permissions: [] });
    expect(html).not.toContain('data-ui="gift-card-adjust-amount"');
    expect(html).toContain("requires a manager approval");
  });

  it("offers the opposite status of the card as it stands", () => {
    expect(render({ status: "ACTIVE" })).toContain("Suspend card");
    expect(render({ status: "SUSPENDED" })).toContain("Activate card");
  });

  it("requires a reason before a status change, because the audit trail needs one", () => {
    expect(render()).toContain('data-ui="gift-card-status-reason"');
  });
});
