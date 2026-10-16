import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AtlasQuantityStepper, clampAffectedQuantity } from "./AtlasQuantityStepper";

describe("Atlas receipt complaint quantity stepper", () => {
  it("limits affected units to the verified purchased amount", () => {
    expect(clampAffectedQuantity(-1, 10)).toBe(0);
    expect(clampAffectedQuantity(2, 10)).toBe(2);
    expect(clampAffectedQuantity(15, 10)).toBe(10);
    expect(clampAffectedQuantity(2.9, 10)).toBe(2);
    expect(clampAffectedQuantity(Number.NaN, 10)).toBe(0);
    expect(clampAffectedQuantity(2, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("renders named 44px actions and disables the decrement at zero", () => {
    const html = renderToStaticMarkup(<AtlasQuantityStepper itemName="Milk" value={0} max={10} onChange={() => {}} />);
    expect(html).toContain("Decrease affected quantity for Milk");
    expect(html).toContain("Increase affected quantity for Milk");
    expect(html).toContain("min-h-11");
    expect(html).toContain("10 purchased");
    expect(html).toMatch(/aria-label="Decrease affected quantity for Milk"[^>]*disabled/);
  });

  it("disables increment at the purchased limit and never renders an invalid value", () => {
    const html = renderToStaticMarkup(<AtlasQuantityStepper itemName="Oat milk" value={15} max={10} onChange={() => {}} />);
    expect(html).toMatch(/aria-label="Increase affected quantity for Oat milk"[^>]*disabled/);
    expect(html).toContain('>10</output>');
    expect(html).not.toContain('>15</output>');
  });
});
