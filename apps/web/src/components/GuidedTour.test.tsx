import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { GuidedTour, guidedTourStepsForRole } from "./GuidedTour";

describe("GuidedTour", () => {
  it("starts with a dismissible first-time workspace introduction", () => {
    const html = renderToStaticMarkup(
      <GuidedTour open role="owner" onDismiss={() => undefined} />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Welcome to NexPOS");
    expect(html).toContain("Skip tour");
    expect(html).toContain("1 of 6");
    expect(html).toContain("Next");
  });

  it("uses a task-oriented owner tour instead of a generic navigation tour", () => {
    const titles = guidedTourStepsForRole("owner").map((step) => step.title);

    expect(titles).toContain("Prepare your catalog");
    expect(titles).toContain("Open a shift before selling");
    expect(titles).toContain("Complete a sale");
    expect(titles).toContain("Review receipts and reports");
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
});
