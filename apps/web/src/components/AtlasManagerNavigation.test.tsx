import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AtlasManagerNavigation } from "./AtlasManagerNavigation";

describe("Atlas V4 manager shell", () => {
  it("exposes manager workflows but not owner-only shortcuts", () => {
    const html = renderToStaticMarkup(<AtlasManagerNavigation pathname="/admin" onNavigate={() => {}} onSignOut={() => {}} signingOut={false} />);
    expect(html).toContain('aria-label="Manager navigation"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/inventory"');
    expect(html).toContain('href="/customer-concerns"');
    expect(html).not.toContain('href="/admin/owner-controls"');
    expect(html).not.toContain('href="/team"');
  });
});
