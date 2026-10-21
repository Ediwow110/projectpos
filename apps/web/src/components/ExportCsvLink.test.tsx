import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExportCsvLink } from "./ExportCsvLink";

Object.assign(globalThis, { React });

describe("csv export link", () => {
  it("navigates to the exact URL it was given and asks the browser to download it", () => {
    const html = renderToStaticMarkup(
      <ExportCsvLink href="http://localhost:3001/api/v1/expenses/export?format=csv" label="Export expenses" bounds="Up to 1,000 rows." />,
    );
    expect(html).toContain('href="http://localhost:3001/api/v1/expenses/export?format=csv"');
    expect(html).toContain("download");
    expect(html).toContain("Export expenses");
  });

  it("states the row bound in the same control that starts the download", () => {
    const html = renderToStaticMarkup(
      <ExportCsvLink href="http://localhost:3001/api/v1/exports/ledger.csv?format=csv" label="Export ledger" bounds="Up to 5,000 rows per export." />,
    );
    expect(html).toContain("5,000 rows per export");
  });
});
