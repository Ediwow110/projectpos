import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NexposLogo } from "./NexposLogo";

describe("NexPOS brand", () => {
  it("renders the supplied logo asset for light surfaces", () => {
    const html = renderToStaticMarkup(<NexposLogo variant="light" size="md" />);

    expect(html).toContain('src="/brand/nexpos-logo.svg"');
    expect(html).toContain('alt="NexPOS — Retail operations"');
  });

  it("keeps the supplied mark visible on dark surfaces", () => {
    const html = renderToStaticMarkup(<NexposLogo variant="dark" size="lg" />);

    expect(html).toContain('src="/brand/nexpos-mark.svg"');
    expect(html).toContain("NEXPOS");
  });
});
