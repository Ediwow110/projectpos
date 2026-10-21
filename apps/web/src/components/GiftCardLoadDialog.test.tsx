import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { GiftCardLoadDialog } from "./GiftCardLoadDialog";
import { GiftCardLoadResultDialog } from "./GiftCardLoadResultDialog";

describe("gift-card load workflow", () => {
  it("resolves a reload card with a CSRF-guarded POST body, never a query string", () => {
    // A bearer code in the URL is captured by proxies, access logs, browser
    // history and APM, so the caller must send it in the request body.
    const source = readFileSync(resolve(process.cwd(), "src/components/GiftCardLoadDialog.tsx"), "utf8");
    expect(source).not.toMatch(/gift-cards\/lookup\?/);
    expect(source).toContain('apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf")');
    expect(source).toContain('"/api/v1/gift-cards/lookup"');
    expect(source).toContain("csrfToken: csrf.csrfToken");
    expect(source).toContain('method: "POST"');
    expect(source).toContain("JSON.stringify({ code: raw })");
  });

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
