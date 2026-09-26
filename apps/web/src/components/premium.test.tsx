import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MetricCard, Panel } from "./premium";
import { StatusPill } from "./ui";

describe("premium UI primitives", () => {
  it("marks metric cards and panels with stable semantic hooks", () => {
    const metric = renderToStaticMarkup(
      <MetricCard label="Net sales" value="₱1,024.00" icon="▥" meta="Up 8.2%" />,
    );
    const panel = renderToStaticMarkup(<Panel>Body</Panel>);

    expect(metric).toContain('data-ui="metric-card"');
    expect(panel).toContain('data-ui="panel"');
  });

  it("keeps status meaning visible as text, not color only", () => {
    const html = renderToStaticMarkup(<StatusPill tone="warn">Needs review</StatusPill>);

    expect(html).toContain("Needs review");
    expect(html).toContain("data-tone=");
  });
});
