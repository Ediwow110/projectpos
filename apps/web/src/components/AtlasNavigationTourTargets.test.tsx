import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { guidedTourStepsForRole } from "./GuidedTour";
import { AtlasApprovalNavigation } from "./AtlasApprovalNavigation";
import { AtlasCashierNavigation } from "./AtlasCashierNavigation";
import { AtlasInventoryNavigation } from "./AtlasInventoryNavigation";
import { AtlasManagerNavigation } from "./AtlasManagerNavigation";
import { AtlasOwnerNavigation } from "./AtlasOwnerNavigation";
import { AtlasPosRail } from "./AtlasPosRail";
import { flattenedWorkspaceNavigation } from "../lib/workspace-navigation";

vi.stubGlobal("React", React);

/** Tour keys emitted by the links of a rendered Atlas navigation component. */
function tourKeys(markup: string): string[] {
  return [...markup.matchAll(/<a\b[^>]*>/g)]
    .map(([anchor]) => /data-tour="([^"]*)"/.exec(anchor)?.[1])
    .filter((key): key is string => typeof key === "string" && key.length > 0);
}

/** Every anchor that the tour can point at must keep the 44px touch target. */
function tourAnchors(markup: string): string[] {
  return [...markup.matchAll(/<a\b[^>]*>/g)]
    .map(([anchor]) => anchor)
    .filter((anchor) => anchor.includes('data-tour="'));
}

function minHeightPx(className: string): number {
  const rem: Record<string, number> = { "8": 32, "9": 36, "10": 40, "11": 44, "12": 48 };
  const tailwind = /(?:^|\s)(?:min-)?h-(\d{1,2})(?:\s|$)/.exec(className);
  if (tailwind?.[1]) return rem[tailwind[1]] ?? 0;
  const arbitrary = /(?:^|\s)(?:min-)?h-\[(\d+(?:\.\d+)?)px\](?:\s|$)/.exec(className);
  return arbitrary?.[1] ? Number(arbitrary[1]) : 0;
}

const render = {
  owner: () => renderToStaticMarkup(
    <AtlasOwnerNavigation pathname="/" onNavigate={() => undefined} onSignOut={() => undefined} signingOut={false} />,
  ),
  managerLanding: () => renderToStaticMarkup(
    <AtlasApprovalNavigation role="manager" pathname="/" onNavigate={() => undefined} onSignOut={() => undefined} signingOut={false} />,
  ),
  managerWorkspace: () => renderToStaticMarkup(
    <AtlasManagerNavigation pathname="/admin" onNavigate={() => undefined} onSignOut={() => undefined} signingOut={false} />,
  ),
  cashier: () => renderToStaticMarkup(
    <AtlasCashierNavigation pathname="/pos" onNavigate={() => undefined} onSignOut={() => undefined} signingOut={false} />,
  ),
  inventory: () => renderToStaticMarkup(
    <AtlasInventoryNavigation role="inventory" pathname="/inventory" onNavigate={() => undefined} onSignOut={() => undefined} signingOut={false} />,
  ),
  posRail: () => renderToStaticMarkup(
    <AtlasPosRail pathname="/pos" onNavigate={() => undefined} onSignOut={() => undefined} signingOut={false} />,
  ),
};

/** `tour-restart` belongs to the workspace header, not to a navigation rail. */
function stepTargetsForRole(role: string): string[] {
  return guidedTourStepsForRole(role)
    .map((step) => step.target)
    .filter((target): target is string => target !== null && target !== "tour-restart");
}

describe("Atlas navigation tour anchors", () => {
  it("covers every guided-tour target of the role in the Atlas shell it lands on", () => {
    const cases = [
      ["owner", render.owner()],
      ["manager", render.managerLanding()],
      ["manager", render.managerWorkspace()],
      ["cashier", render.cashier()],
      ["inventory", render.inventory()],
    ] as const;

    for (const [role, markup] of cases) {
      const emitted = new Set(tourKeys(markup));
      for (const target of stepTargetsForRole(role)) {
        expect(emitted.has(target), `${role} Atlas shell is missing data-tour="${target}"`).toBe(true);
      }
    }
  });

  it("keys the compact POS rail with the same tour vocabulary", () => {
    expect(tourKeys(render.posRail()).sort()).toEqual(["orders", "pos", "products", "shifts"]);
  });

  it("invents no tour key: each one matches the workspace-navigation vocabulary for the same href", () => {
    const vocabulary = flattenedWorkspaceNavigation("owner").map((item) => `${item.href}=${item.tour}`);
    for (const markup of Object.values(render).map((fn) => fn())) {
      for (const anchor of tourAnchors(markup)) {
        const href = /href="([^"]*)"/.exec(anchor)?.[1];
        const tour = /data-tour="([^"]*)"/.exec(anchor)?.[1];
        expect(href, `anchor without href: ${anchor}`).toBeTruthy();
        expect(vocabulary, `unmapped ${href}=${tour}`).toContain(`${href}=${tour}`);
      }
    }
  });

  it("keeps a 44px touch target on every tour-addressable navigation link", () => {
    for (const markup of Object.values(render).map((fn) => fn())) {
      for (const anchor of tourAnchors(markup)) {
        const className = /class="([^"]*)"/.exec(anchor)?.[1] ?? "";
        expect(minHeightPx(className), `tour link under 44px: ${anchor}`).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
