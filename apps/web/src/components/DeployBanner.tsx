"use client";

import { useEffect, useState } from "react";
import type { JSX } from "react";

import { fetchBuildInfo, type WebBuildIdentity } from "../lib/build-info";

/**
 * Environment banner.
 *
 * A staging deploy must never be mistaken for production. The pages are
 * statically prerendered, so the identity is fetched from this service's own
 * build-info route at request time - it always describes the deploy that is
 * actually serving, and it is the same deploy the API reports at /version.
 *
 * The banner renders only when the deploy is labelled as a non-production
 * environment, so production can never show it.
 */
export function DeployBanner(): JSX.Element | null {
  const [build, setBuild] = useState<WebBuildIdentity | null>(null);

  useEffect(() => {
    let active = true;
    void fetchBuildInfo().then((identity) => {
      if (active) setBuild(identity);
    });
    return () => {
      active = false;
    };
  }, []);

  const environment = build?.environment;
  if (!environment) return null;

  const sha = build?.sha ? build.sha.slice(0, 7) : "unknown";

  return (
    <div
      data-ui="deploy-banner"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-[#202826] px-4 py-2 text-[12px] text-[#f7f8f5]"
    >
      <span className="font-semibold">{environment}</span>
      <span aria-hidden="true">·</span>
      <span className="font-data">build {sha}</span>
      <span aria-hidden="true">·</span>
      <span>not production</span>
    </div>
  );
}
