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
 * Primary buttons carry the brand coral. The label is small semibold text, so
 * WCAG AA needs 4.5:1 on the resting fill AND on hover - white on coral measures
 * 3.26:1, which is why the label is an ink tone here rather than white.
 */
describe("primary action label", () => {
  const uiSource = readFileSync(new URL("../components/ui.tsx", import.meta.url), "utf8");
  const buttonClass = uiSource.split("export function PrimaryButton")[1]?.split("export function")[0] ?? "";

  function paint(pattern: RegExp): string | undefined {
    const match = pattern.exec(buttonClass);
    if (!match) return undefined;
    if (match[1]) return token(match[1]);
    return match[2] ? `#${match[2]}` : undefined;
  }

  const fill = paint(/(?:^| )bg-\[(?:var\(--color-([a-z0-9-]+)\)|#([0-9a-fA-F]{6}))\]/);
  const hover = paint(/hover:bg-\[(?:var\(--color-([a-z0-9-]+)\)|#([0-9a-fA-F]{6}))\]/);
  const label = paint(/(?:^| )text-\[(?:var\(--color-([a-z0-9-]+)\)|#([0-9a-fA-F]{6}))\]/);

  it("states its own colours so the gate cannot pass by matching nothing", () => {
    expect(fill, "primary fill must be a hex or a --color-* token").toBeTruthy();
    expect(hover, "hover fill must be a hex or a --color-* token").toBeTruthy();
    expect(label, "label colour must be a hex or a --color-* token").toBeTruthy();
  });

  it("keeps the label readable on the resting and hover fills", () => {
    expect(fill).toBeTruthy();
    expect(hover).toBeTruthy();
    expect(label).toBeTruthy();
    expect(contrastRatio(label!, fill!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(label!, hover!)).toBeGreaterThanOrEqual(4.5);
  });
});

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

  it("keeps muted owner labels readable on white and canvas surfaces", () => {
    expect(contrastRatio(token("atlas-muted-strong"), token("atlas-surface")))
      .toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("atlas-muted-strong"), token("atlas-canvas")))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("documents that the plain accent is only safe for non-text indicators", () => {
    const plain = contrastRatio(token("atlas-accent"), token("atlas-surface"));
    expect(plain).toBeGreaterThanOrEqual(3);
    expect(plain).toBeLessThan(4.5);
  });
});

/**
 * Text-token contract for the shared UI primitives.
 *
 * The assertions above only cover the two `-strong` tokens and the non-text
 * accent rule. They say nothing about success/warning/danger/info *as text*,
 * which is how StatusPill, MetricCard and the Modal eyebrow colour their words.
 * That gap let `text-[#1f8a5b]` (3.93:1 on #eaf7f0) and `text-[#b56d0c]`
 * (3.73:1 on #fff4df) ship as 10-12px labels.
 *
 * So this block enumerates, straight from source, every arbitrary `text-[...]`
 * foreground in the primitives and gates it two ways: a status literal must be
 * one of the approved text-safe values, and every enumerated foreground must
 * measure AA (4.5:1) against the background it renders on.
 *
 * Ownership note: Pos*.tsx and app/pos/* are deliberately outside this list
 * (owned elsewhere), and the non-POS pages/components still carry
 * failing-as-text literals. Widen SHARED_UI_FILES as those files are adopted.
 */
const SHARED_UI_FILES = [
  "../components/ui.tsx",
  "../components/premium.tsx",
  "../components/Modal.tsx",
];

/** Status semantics may only render as text in these tokens (measured below). */
const STATUS_TOKENS = ["success", "warning", "danger", "info"];
const APPROVED_TEXT_TOKENS = ["atlas-verified", "atlas-accent-strong", "atlas-muted-strong", "danger", "info"];

/**
 * Accent/muted literals - token-backed or hand-typed copies - that this file
 * proves are under AA as text. A component may still use them for borders,
 * bars, dots and other non-text indicators.
 */
const NON_TEXT_SAFE_LITERALS: Array<{ hex: string; label: string; surface: string }> = [
  { hex: token("success"), label: "--color-success", surface: token("success-soft") },
  { hex: token("warning"), label: "--color-warning", surface: token("warning-soft") },
  { hex: token("faint"), label: "--color-faint", surface: token("atlas-surface") },
  { hex: token("coral"), label: "--color-coral", surface: token("atlas-surface") },
  { hex: token("coral-hover"), label: "--color-coral-hover", surface: token("atlas-surface") },
  { hex: token("atlas-accent"), label: "--color-atlas-accent", surface: token("atlas-surface") },
  { hex: token("atlas-muted"), label: "--color-atlas-muted", surface: token("atlas-surface") },
  { hex: "#e44e34", label: "coral accent literal (not a token)", surface: token("atlas-surface") },
  { hex: "#71807a", label: "atlas-muted literal (not a token)", surface: token("atlas-surface") },
  { hex: "#9a6e32", label: "warning literal (not a token)", surface: token("warning-soft") },
];

/** A line may opt out only by naming the non-text carrier it paints. */
const NON_TEXT_MARKER = "contrast-gate: non-text";

type TextForeground = {
  site: string;
  variant: string;
  value: string;
  hex: string;
  background: string;
  exempt: boolean;
};

function resolveColor(value: string): string | null {
  const literal = /^#[0-9a-fA-F]{6}$/.exec(value);
  if (literal) return literal[0].toLowerCase();
  const variable = /^var\(--color-([a-z0-9-]+)\)$/.exec(value);
  if (variable) return token(variable[1]!);
  return null;
}

/** Same-line background pairing: `bg-[#eaf7f0] text-[#...]` reads its own soft surface. */
function backgroundOf(line: string): string {
  const arbitrary = /(?:^|[^:\w-])bg-\[([^\]]+)\]/.exec(line);
  const resolved = arbitrary?.[1] ? resolveColor(arbitrary[1].trim()) : null;
  return resolved ?? token("atlas-surface");
}

function readSharedUiSource(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

function sharedUiTextForegrounds(): TextForeground[] {
  const sites: TextForeground[] = [];
  for (const file of SHARED_UI_FILES) {
    const source = readSharedUiSource(file);
    source.split("\n").forEach((line, index) => {
      const pattern = /(?:^|[^:\w-])((?:[a-zA-Z-]+:)*text-\[([^\]]+)\])/g;
      for (const match of line.matchAll(pattern)) {
        const value = match[2]!.trim();
        const hex = resolveColor(value);
        // `text-[10px]`, `text-white`, etc. carry no semantic colour literal.
        if (!hex) continue;
        sites.push({
          site: `${file}:${index + 1}`,
          variant: match[1]!,
          value,
          hex,
          background: backgroundOf(line),
          exempt: line.includes(NON_TEXT_MARKER),
        });
      }
    });
  }
  return sites;
}

/**
 * Independent of the scan regex above: counted with plain string search, so a
 * pattern that quietly stops matching cannot leave the gate collecting nothing.
 */
function rawForegroundCount(source: string): number {
  return (source.split("text-[#").length - 1) + (source.split("text-[var(--color-").length - 1);
}

describe("Atlas semantic-text token contract", () => {
  const sites = sharedUiTextForegrounds();

  it("actually reads the primitives it claims to police", () => {
    // A gate that silently stopped collecting sites is the failure mode this
    // repo has been burned by twice, so the scan is asserted, not assumed:
    // the file list has a floor, every listed file must yield sites, and each
    // file's collected count must match a regex-free recount of its source.
    expect(SHARED_UI_FILES.length, "policed primitive count").toBeGreaterThanOrEqual(3);
    for (const file of SHARED_UI_FILES) {
      const collected = sites.filter((site) => site.site.startsWith(file));
      expect(collected, `${file} yielded no foregrounds`).not.toHaveLength(0);
      expect(
        collected.length,
        `${file}: collected foregrounds vs. raw source recount`,
      ).toBe(rawForegroundCount(readSharedUiSource(file)));
    }
    console.log(
      `[atlas-contrast] enumerated ${sites.length} text-[...] foregrounds in ` +
      `${SHARED_UI_FILES.length} shared primitives ` +
      `(${sites.filter((site) => site.exempt).length} marked non-text).`,
    );
  });

  it("proves each approved text token clears AA on the surface it is used on", () => {
    const surfaces = [token("atlas-surface"), token("atlas-canvas"), token("success-soft"), token("warning-soft"), token("danger-soft"), token("info-soft")];
    for (const name of APPROVED_TEXT_TOKENS) {
      const value = token(name);
      const readable = surfaces.map((surface) => contrastRatio(value, surface));
      expect(Math.min(...readable), `${name} must clear 4.5:1 on every Atlas surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps status semantics out of non-text-safe literals", () => {
    const approved = new Set(APPROVED_TEXT_TOKENS.map((name) => token(name)));
    const statusValues = new Set(STATUS_TOKENS.map((name) => token(name)));
    const offenders = sites
      .filter((site) => !site.exempt && statusValues.has(site.hex) && !approved.has(site.hex))
      .map((site) => `${site.site} ${site.variant}=${site.hex} (${contrastRatio(site.hex, site.background).toFixed(2)}:1 on ${site.background})`);
    expect(offenders, "semantic status colour used as text").toEqual([]);
  });

  it("keeps every enumerated foreground at AA contrast on its rendered background", () => {
    const offenders = sites
      .filter((site) => !site.exempt && contrastRatio(site.hex, site.background) < 4.5)
      .map((site) => `${site.site} ${site.variant}=${site.hex} on ${site.background} = ${contrastRatio(site.hex, site.background).toFixed(2)}:1`);
    expect(offenders, "text foreground below 4.5:1 AA").toEqual([]);
  });

  it("documents the non-text-safe literals with their measured ratios", () => {
    for (const entry of NON_TEXT_SAFE_LITERALS) {
      // Keeps the ledger honest: a literal may only be listed while it really
      // is under AA on the surface it is used on, so the list cannot rot into a
      // false claim about a colour that was darkened in globals.css.
      expect(contrastRatio(entry.hex, entry.surface), entry.label).toBeLessThan(4.5);
    }
    const usedAsText = sites
      .filter((site) => !site.exempt && NON_TEXT_SAFE_LITERALS.some((entry) => entry.hex === site.hex))
      .map((site) => `${site.site} ${site.variant}=${site.hex}`);
    expect(usedAsText, "non-text-safe literal used as a text foreground").toEqual([]);
  });
});
