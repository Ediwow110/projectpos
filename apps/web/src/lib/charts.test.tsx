import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DonutChart,
  GroupedBarChart,
  HeatmapChart,
  HorizontalBarChart,
  VerticalBarChart,
} from "./charts";

describe("premium chart primitives", () => {
  it("renders an explicit empty state without invalid SVG values", () => {
    const html = renderToStaticMarkup(
      <VerticalBarChart bars={[]} label="Daily sales" />,
    );

    expect(html).toContain("No chart data available");
    expect(html).not.toContain("NaN");
  });

  it("gives grouped and donut charts accessible names", () => {
    const grouped = renderToStaticMarkup(
      <GroupedBarChart
        label="Gross and net"
        groups={[{ label: "Mon", primary: 100, secondary: 90 }]}
      />,
    );
    const donut = renderToStaticMarkup(
      <DonutChart
        label="Payment mix"
        segments={[
          { label: "Cash", value: 70 },
          { label: "Card", value: 30 },
        ]}
      />,
    );

    expect(grouped).toContain("<title>Gross and net</title>");
    expect(donut).toContain("<title>Payment mix</title>");
  });

  it("renders horizontal bars and heatmaps from finite values", () => {
    const bars = renderToStaticMarkup(
      <HorizontalBarChart label="Categories" bars={[{ label: "Beverages", value: 12 }]} />,
    );
    const heatmap = renderToStaticMarkup(
      <HeatmapChart label="Orders by hour" rows={["Mon"]} columns={["9a"]} values={[[4]]} />,
    );

    expect(bars).toContain("Beverages");
    expect(heatmap).toContain("Orders by hour");
    expect(heatmap).not.toContain("NaN");
  });
});
