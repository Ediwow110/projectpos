import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AtlasOwnerNavigation } from "./AtlasOwnerNavigation";

vi.stubGlobal("React", React);

describe("Atlas owner navigation", () => {
  it.each([
    ["/", "/"],
    ["/admin/owner-controls", "/admin/owner-controls"],
    ["/team", "/team"],
    ["/branches", "/branches"],
    ["/customer-concerns", "/customer-concerns"],
    ["/customer-concerns/new/2026-000001", "/customer-concerns"],
    ["/admin/support", "/admin/support"],
  ])("marks %s as the active owner destination", (pathname, href) => {
    const markup = renderToStaticMarkup(
      <AtlasOwnerNavigation pathname={pathname} onNavigate={() => {}} onSignOut={() => {}} signingOut={false} />,
    );
    const matchingLink = [...markup.matchAll(/<a\b[^>]*>/g)]
      .map(([anchor]) => anchor)
      .find((anchor) => anchor.includes(`href="${href}"`) && anchor.includes("min-h-[48px]"));

    expect(matchingLink, `Expected owner nav link for ${href}`).toBeDefined();
    expect(matchingLink).toContain('aria-current="page"');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("exposes the real business setup review surface to owners", () => {
    const markup = renderToStaticMarkup(
      <AtlasOwnerNavigation pathname="/" onNavigate={() => {}} onSignOut={() => {}} signingOut={false} />,
    );
    const setupLinks = [...markup.matchAll(/<a\b[^>]*>/g)]
      .map(([anchor]) => anchor)
      .filter((anchor) => anchor.includes('href="/onboarding"'));

    expect(setupLinks).toHaveLength(1);
    expect(markup).toContain("Business setup");
  });

  it("marks the business setup destination as active while reviewing setup", () => {
    const markup = renderToStaticMarkup(
      <AtlasOwnerNavigation pathname="/onboarding" onNavigate={() => {}} onSignOut={() => {}} signingOut={false} />,
    );
    const matchingLink = [...markup.matchAll(/<a\b[^>]*>/g)]
      .map(([anchor]) => anchor)
      .find((anchor) => anchor.includes('href="/onboarding"') && anchor.includes("min-h-[48px]"));

    expect(matchingLink).toBeDefined();
    expect(matchingLink).toContain('aria-current="page"');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
