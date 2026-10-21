import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import OrderHelpPage from "./page";

vi.stubGlobal("React", React);

/** Tiles inside "Choose what you need help with" only; the header nav is separate. */
function pathTiles(html: string): string[] {
  const section = /<section aria-label="Order support paths"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  return [...section.matchAll(/<(a|div)\b[^>]*data-ui="order-help-path[^"]*"[^>]*>/g)].map(([tag]) => tag);
}

describe("guest order help paths", () => {
  it("offers one real destination and says so with exactly one arrow", () => {
    const html = renderToStaticMarkup(<OrderHelpPage />);
    const tiles = pathTiles(html);

    expect(tiles).toHaveLength(4);
    expect(tiles.filter((tile) => tile.startsWith("<a "))).toHaveLength(1);
    expect(html.match(/→/g)).toHaveLength(1);
  });

  it("links only the tracking path and keeps the rest as non-navigating notes", () => {
    const html = renderToStaticMarkup(<OrderHelpPage />);
    const tiles = pathTiles(html);
    const link = tiles.find((tile) => tile.startsWith("<a "));

    expect(link).toContain('href="/order-status"');
    expect(link).toContain('data-ui="order-help-path-link"');
    for (const note of tiles.filter((tile) => tile.startsWith("<div "))) {
      expect(note).toContain('data-ui="order-help-path-note"');
      expect(note).not.toContain("href=");
      expect(note).not.toContain("hover:bg-");
    }
    expect(tiles.filter((tile) => tile.includes('href="/order-status"'))).toHaveLength(1);
  });

  it("points every topic at the verified status page as the only support channel", () => {
    const html = renderToStaticMarkup(<OrderHelpPage />);

    expect(html).toContain("Report a problem");
    expect(html).toContain("Payment concerns");
    expect(html).toContain("Store contact");
    expect(html).toContain("status page");
    expect(html).not.toContain("Questions about pickup or delivery belong to your verified order.");
  });
});
