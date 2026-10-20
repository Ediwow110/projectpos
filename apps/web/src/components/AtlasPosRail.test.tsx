import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AtlasPosRail } from "./AtlasPosRail";

describe("Atlas V4 cashier rail", () => {
  it("provides accessible native navigation to real POS-related routes", () => {
    const html = renderToStaticMarkup(<AtlasPosRail pathname="/pos" onNavigate={() => undefined} onSignOut={() => undefined} signingOut={false} />);
    expect(html).toContain('aria-label="Cashier sale navigation"');
    expect(html).toContain('aria-current="page"');
    for (const href of ["/pos", "/products", "/orders", "/shifts"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain('aria-label="Sign out"');
  });
});
