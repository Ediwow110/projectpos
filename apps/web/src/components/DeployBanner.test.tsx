import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeployBanner } from "./DeployBanner";

vi.stubGlobal("React", React);

describe("deploy banner", () => {
  afterEach(() => {
    delete process.env["DEPLOY_ENV"];
    delete process.env["RENDER_GIT_COMMIT"];
  });

  it("names the environment, the build and the fact that it is not production", () => {
    process.env["DEPLOY_ENV"] = "staging";
    process.env["RENDER_GIT_COMMIT"] = "75e82628247b29d4cd7118df9c49fa8b1613dfcc";

    const markup = renderToStaticMarkup(<DeployBanner />);

    expect(markup).toContain("Staging");
    expect(markup).toContain("75e8262");
    expect(markup).toContain("not production");
  });

  it("renders nothing in production", () => {
    process.env["DEPLOY_ENV"] = "production";
    process.env["RENDER_GIT_COMMIT"] = "75e82628247b29d4cd7118df9c49fa8b1613dfcc";

    expect(renderToStaticMarkup(<DeployBanner />)).toBe("");
  });

  it("renders nothing when the environment is not labelled", () => {
    process.env["RENDER_GIT_COMMIT"] = "75e82628247b29d4cd7118df9c49fa8b1613dfcc";

    expect(renderToStaticMarkup(<DeployBanner />)).toBe("");
  });

  it("says the build is unknown rather than showing a made-up commit", () => {
    process.env["DEPLOY_ENV"] = "staging";

    const markup = renderToStaticMarkup(<DeployBanner />);

    expect(markup).toContain("build unknown");
  });

  it("keeps the banner text at the 12px minimum the accessibility audit requires", () => {
    process.env["DEPLOY_ENV"] = "staging";
    process.env["RENDER_GIT_COMMIT"] = "75e82628247b29d4cd7118df9c49fa8b1613dfcc";

    const markup = renderToStaticMarkup(<DeployBanner />);

    expect(markup).toContain("text-[12px]");
    expect(markup).not.toMatch(/text-\[(?:[0-9]|1[01])px\]/);
  });
});
