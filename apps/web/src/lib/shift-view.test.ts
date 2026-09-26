import { describe, expect, it } from "vitest";

import { shiftState, variancePresentation } from "./shift-view";

describe("shift presentation", () => {
  it("preserves variance direction", () => {
    expect(variancePresentation(120)).toEqual({ state: "over", tone: "warn", amount: 120 });
    expect(variancePresentation(-80)).toEqual({ state: "short", tone: "bad", amount: -80 });
    expect(variancePresentation(0)).toEqual({ state: "balanced", tone: "ok", amount: 0 });
  });

  it("never presents an open shift as closed", () => {
    expect(shiftState("OPEN")).toEqual({ label: "Open", tone: "info", closed: false });
    expect(shiftState("CLOSED")).toEqual({ label: "Closed", tone: "ok", closed: true });
  });
});
