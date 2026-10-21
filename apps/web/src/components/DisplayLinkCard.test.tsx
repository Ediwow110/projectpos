import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DisplayLinkCard } from "./DisplayLinkCard";

Object.assign(globalThis, { React });

const ticket = {
  registerId: "reg_1",
  registerName: "Front Till",
  link: "http://localhost:3100/display?registerId=reg_1&token=deadbeef",
  expiresAt: "2026-10-22T05:15:00.000Z",
};

describe("customer display link card", () => {
  it("shows the link the display page needs, in a form a staff member can act on", () => {
    const html = renderToStaticMarkup(<DisplayLinkCard ticket={ticket} />);
    expect(html).toContain("deadbeef");
    expect(html).toContain("Front Till");
    expect(html).toContain('href="http://localhost:3100/display?registerId=reg_1&amp;token=deadbeef"');
  });

  it("names the lifetime instead of leaving the link unexplained", () => {
    const html = renderToStaticMarkup(<DisplayLinkCard ticket={ticket} />);
    expect(html).toContain("15 minutes");
  });

  it("warns that this is the only chance to copy the token", () => {
    const html = renderToStaticMarkup(<DisplayLinkCard ticket={ticket} />);
    expect(html).toContain("shown once");
  });

  it("renders nothing without a ticket rather than an empty dialog", () => {
    expect(renderToStaticMarkup(<DisplayLinkCard ticket={null} />)).toBe("");
  });
});
