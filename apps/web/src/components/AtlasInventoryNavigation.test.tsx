import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AtlasInventoryNavigation } from "./AtlasInventoryNavigation";

vi.stubGlobal("React", React);

describe("Atlas inventory sidebar active destination", () => {
  const markupFor = (pathname: string) => renderToStaticMarkup(
    <AtlasInventoryNavigation pathname={pathname} role="inventory"
      onNavigate={() => undefined} onSignOut={() => undefined} signingOut={false} />,
  );

  it("marks the workbench and count pages as the sole current page", () => {
    const home = markupFor("/inventory");
    expect(home.match(/aria-current="page"/g)).toHaveLength(1);
    expect(home).toMatch(/aria-current="page"[^>]*>My work<\/a>/);

    const counts = markupFor("/inventory/counts/new");
    expect(counts.match(/aria-current="page"/g)).toHaveLength(1);
    expect(counts).toMatch(/aria-current="page"[^>]*>Counts<\/a>/);
  });

  it("lists one purchase-order destination instead of a duplicate Receiving link", () => {
    const html = markupFor("/purchase-orders/123");
    expect(html).not.toContain(">Receiving</a>");
    expect([...html.matchAll(/<a\b[^>]*href="\/purchase-orders"[^>]*>/g)]).toHaveLength(1);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Purchase orders<\/a>/);
  });
});
