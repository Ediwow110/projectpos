import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosManagerApprovalDialog } from "./PosManagerApprovalDialog";

describe("POS manager approval dialog", () => {
  it("supports a masked six-digit approval PIN with password fallback and explains one-use approval", () => {
    const html = renderToStaticMarkup(
      <PosManagerApprovalDialog
        action="pay"
        discountMinor={300}
        busy={false}
        error=""
        onApprove={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Manager approval");
    expect(html).toContain('data-ui="atlas-flow-modal"');
    expect(html).toContain("Manager email");
    expect(html).toContain("Approval PIN");
    expect(html).toContain("Use password instead");
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('type="password"');
    expect(html).toContain("one-use");
    expect(html).toContain("₱3.00");
    expect(html).toContain("Approve &amp; continue");
  });
});
