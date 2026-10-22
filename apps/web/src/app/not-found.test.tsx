import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

import NotFound from "./not-found";

describe("not found page", () => {
  it("names the outcome and offers a way back into the workspace", () => {
    const html = renderToStaticMarkup(<NotFound />);

    // The audit asks for a recovery path. A bare 404 with no way back is not one.
    expect(html).toContain("Error 404");
    expect(html).toContain("<h1");
    expect(html).toContain("That address is not part of the workspace");
    expect(html).toContain("Back to workspace");
    expect(html).toContain('href="/"');
    expect(html).toContain("Sign in");
    expect(html).toContain('href="/login"');
  });

  it("gives both recovery links a reachable target", () => {
    const html = renderToStaticMarkup(<NotFound />);
    const links = html.match(/<a [^>]*>/g) ?? [];

    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link, `recovery link target: ${link}`).toContain("min-h-11");
    }
  });
});
