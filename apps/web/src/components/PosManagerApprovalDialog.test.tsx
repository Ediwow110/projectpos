import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PosManagerApprovalDialog } from "./PosManagerApprovalDialog";

describe("POS manager approval dialog", () => {
  it("uses masked manager credentials and explains the one-use discount approval", () => {
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
    expect(html).toContain("Manager email");
    expect(html).toContain("Manager password");
    expect(html).toContain('type="password"');
    expect(html).toContain("one-use");
    expect(html).toContain("₱3.00");
    expect(html).toContain("Approve &amp; continue");
  });
});
