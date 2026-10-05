import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { GiftCardLoadDialog } from "./GiftCardLoadDialog";
import { GiftCardLoadResultDialog } from "./GiftCardLoadResultDialog";

describe("gift-card load workflow", () => {
  it("exposes accessible new/reload controls and online-only guidance", () => {
    const html = renderToStaticMarkup(<GiftCardLoadDialog onSave={() => undefined} onClose={() => undefined} />);
    expect(html).toContain("Load a gift card");
    expect(html).toContain("New gift card");
    expect(html).toContain("Reload card");
    expect(html).toContain("Load amount (PHP)");
    expect(html).toContain("online-only");
  });

  it("shows the one-time bearer warning and a labelled Code128 preview", () => {
    const html = renderToStaticMarkup(<GiftCardLoadResultDialog code="NXP-GC-ONE-TIME" amountMinor={1000} onClose={() => undefined} />);
    expect(html).toContain("Treat this bearer code like cash");
    expect(html).toContain("Copy code");
    expect(html).toContain("Print");
    expect(html).toContain('aria-label="Code128 barcode preview"');
    expect(html).toContain("NXP-GC-ONE-TIME");
  });
});
