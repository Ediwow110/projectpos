import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) throw new Error(`missing design token --color-${name}`);
  return match[1]!;
}

function channel(value: number): number {
  const ratio = value / 255;
  return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((offset) =>
    channel(Number.parseInt(hex.slice(offset, offset + 2), 16)));
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (light! + 0.05) / (dark! + 0.05);
}

/**
 * Active navigation and eyebrow labels are small text (10-14px), so WCAG AA
 * requires 4.5:1. The plain accent is 3.26:1 on the accent-soft row; the
 * strong accent is the documented token for text on light Atlas surfaces.
 */
describe("Atlas navigation contrast", () => {
  it("keeps active navigation text readable on the accent-soft row", () => {
    expect(contrastRatio(token("atlas-accent-strong"), token("atlas-accent-soft")))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("keeps accent text readable on the white and canvas surfaces", () => {
    expect(contrastRatio(token("atlas-accent-strong"), token("atlas-surface")))
      .toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("atlas-accent-strong"), token("atlas-canvas")))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("documents that the plain accent is only safe for non-text indicators", () => {
    const plain = contrastRatio(token("atlas-accent"), token("atlas-surface"));
    expect(plain).toBeGreaterThanOrEqual(3);
    expect(plain).toBeLessThan(4.5);
  });
});
