import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { GuidedTour, guidedTourStepsForRole, resolveTourTarget } from "./GuidedTour";

describe("GuidedTour", () => {
  it("starts with a dismissible first-time workspace introduction", () => {
    const html = renderToStaticMarkup(
      <GuidedTour open role="owner" onDismiss={() => undefined} />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Welcome to NexPOS");
    expect(html).toContain("Skip tour");
    expect(html).toContain("1 of 7");
    expect(html).toContain("Next");
  });

  it("uses a task-oriented owner tour instead of a generic navigation tour", () => {
    const titles = guidedTourStepsForRole("owner").map((step) => step.title);

    expect(titles).toContain("Prepare your catalog");
    expect(titles).toContain("Open a shift before selling");
    expect(titles).toContain("Complete a sale");
    expect(titles).toContain("Review receipts and reports");
    expect(titles).toContain("Manage access and workspace settings");
  });

  it("keeps owner-only administration copy out of the manager tour", () => {
    const titles = guidedTourStepsForRole("manager").map((step) => step.title);
    expect(titles).not.toContain("Manage access and workspace settings");
    expect(titles).toContain("Complete a sale");
  });

  it("does not walk a cashier through owner-only administration", () => {
    const steps = guidedTourStepsForRole("cashier");
    const titles = steps.map((step) => step.title);
    const copy = steps.map((step) => step.body).join(" ");

    expect(titles).toContain("Open your shift");
    expect(titles).toContain("Build the cart and take payment");
    expect(titles).toContain("Find the sale again");
    expect(titles).not.toContain("Prepare your catalog");
    expect(copy).not.toContain("Branches");
  });

  it("keeps the workspace usable while a step instructs an action", () => {
    const html = renderToStaticMarkup(<GuidedTour open role="owner" onDismiss={() => undefined} />);

    const wrapper = /<div class="([^"]*)"[^>]*role="presentation"/.exec(html);
    expect(wrapper?.[1], "tour overlay must not intercept pointer events").toContain("pointer-events-none");

    const backdrop = /<div class="(absolute inset-0[^"]*)"[^>]*aria-hidden/.exec(html);
    expect(backdrop?.[1], "dim backdrop must not intercept pointer events").toContain("pointer-events-none");

    const dialog = /<section[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? "";
    expect(dialog, "the tour dialog itself stays interactive").toContain("pointer-events-auto");
  });
});

describe("resolveTourTarget", () => {
  it("uses a rendered candidate and leaves closed disclosures closed", () => {
    const disclosure = { open: false };
    const hidden = { getClientRects: () => [], parentDisclosure: disclosure };
    const rendered = { getClientRects: () => [{}] };

    expect(resolveTourTarget([hidden, rendered])).toBe(rendered);
    expect(disclosure.open).toBe(false);
  });

  it("reveals the destination disclosure that hides the only matching target", () => {
    const disclosure = { open: false };
    const candidate = { getClientRects: () => (disclosure.open ? [{}] : []), parentDisclosure: disclosure };

    expect(resolveTourTarget([candidate])).toBe(candidate);
    expect(disclosure.open).toBe(true);
  });

  it("reports no highlight when nothing matches or nothing can render", () => {
    expect(resolveTourTarget([])).toBeNull();
    expect(resolveTourTarget([{ getClientRects: () => [] }])).toBeNull();
    expect(resolveTourTarget([{ getClientRects: () => [], parentDisclosure: { open: true } }])).toBeNull();
  });
});
