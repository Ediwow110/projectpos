import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeployBanner } from "./DeployBanner";

vi.stubGlobal("React", React);

describe("deploy banner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing before the identity is known", () => {
    // The pages are prerendered, so the banner must not claim an environment
    // it has not confirmed yet.
    expect(renderToStaticMarkup(<DeployBanner />)).toBe("");
  });
});
