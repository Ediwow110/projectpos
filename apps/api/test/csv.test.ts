import { describe, expect, it } from "vitest";
import { toCsv } from "../src/common/csv";

describe("csv helper", () => {
  it("quotes commas and embedded quotes", () => {
    const out = toCsv(["a", "b"], [["x,y", 'q"z'], [1, null]]);
    expect(out).toBe("\uFEFFa,b\n\"x,y\",\"q\"\"z\"\n1,");
  });
});
