import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AtlasWorkspaceDestinations } from "./AtlasWorkspaceDestinations";

vi.stubGlobal("React", React);

describe("Atlas cross-workspace navigation", () => {
  it("keeps operational routes discoverable without duplicating primary links", () => {
    const markup = renderToStaticMarkup(
      <AtlasWorkspaceDestinations role="owner" onNavigate={() => {}} excludedPaths={["/team"]} />,
    );
    expect(markup).toContain("All workspace destinations");
    expect(markup).toContain('aria-label="All workspace destinations"');
    expect(markup).toContain('href="/purchase-orders"');
    expect(markup).toContain('href="/devices"');
    expect(markup).not.toContain('href="/team"');
  });

  it("does not surface owner-only routes in manager or inventory role menus", () => {
    for (const role of ["manager", "inventory"]) {
      const markup = renderToStaticMarkup(
        <AtlasWorkspaceDestinations role={role} onNavigate={() => {}} />,
      );
      expect(markup).not.toContain('href="/team"');
      expect(markup).not.toContain('href="/admin/owner-controls"');
      expect(markup).not.toContain('href="/admin/support"');
    }
  });
});
