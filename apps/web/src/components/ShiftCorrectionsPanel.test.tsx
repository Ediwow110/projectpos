import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ShiftCorrectionsPanel } from "./ShiftCorrectionsPanel";

Object.assign(globalThis, { React });

const recorded = [
  { id: "shcor_1", amountMinor: -4530, reason: "Float short after till audit", actorId: "usr_owner_1", createdAt: "2026-10-01T09:12:00.000Z" },
];

function render(overrides: Partial<React.ComponentProps<typeof ShiftCorrectionsPanel>> = {}): string {
  return renderToStaticMarkup(
    <ShiftCorrectionsPanel
      shiftId="sh_1"
      status="CLOSED"
      corrections={recorded}
      correctedExpectedCashMinor={95_470}
      permissions={["shift.close.override"]}
      onRecorded={vi.fn()}
      {...overrides}
    />,
  );
}

describe("shift corrections panel", () => {
  it("shows the corrections the shift report already carries", () => {
    const html = render();
    expect(html).toContain("Float short after till audit");
    expect(html).toContain("45.30");
  });

  it("states the corrected expected cash from the server instead of recomputing it", () => {
    const html = render();
    expect(html).toContain("954.70");
    expect(html).not.toContain("1000.00");
  });

  it("says so when a closed shift has no corrections", () => {
    const html = render({ corrections: [], correctedExpectedCashMinor: null });
    expect(html).toContain("No corrections recorded");
  });

  it("offers no way to record a correction without the grant", () => {
    const html = render({ permissions: [] });
    expect(html).not.toContain('data-ui="shift-correction-form"');
  });

  it("offers no way to record a correction against a shift that is still open", () => {
    const html = render({ status: "OPEN" });
    expect(html).not.toContain('data-ui="shift-correction-form"');
  });

  it("offers the correction form to a granted reviewer of a closed shift", () => {
    const html = render();
    expect(html).toContain('data-ui="shift-correction-form"');
    expect(html).toContain('data-ui="shift-correction-amount"');
    expect(html).toContain('data-ui="shift-correction-reason"');
  });
});
