import type { JSX } from "react";

/**
 * Environment banner.
 *
 * A staging deploy must never be mistaken for production. This is a server
 * component, so it reads the deploy environment and the commit of the
 * running build directly on the server and renders on every page, including
 * the public ones an auditor reaches before signing in.
 *
 * It renders only when DEPLOY_ENV names a non-production environment, so
 * production - where DEPLOY_ENV is absent - can never show it.
 */
export function DeployBanner(): JSX.Element | null {
  const environment = process.env["DEPLOY_ENV"]?.trim();
  if (!environment || environment.toLowerCase() === "production") return null;

  const sha = process.env["RENDER_GIT_COMMIT"]?.trim();
  const build = sha ? sha.slice(0, 7) : "unknown";
  const label = environment.charAt(0).toUpperCase() + environment.slice(1);

  return (
    <div
      data-ui="deploy-banner"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-[#202826] px-4 py-2 text-[12px] text-[#f7f8f5]"
    >
      <span className="font-semibold">{label}</span>
      <span aria-hidden="true">·</span>
      <span className="font-data">build {build}</span>
      <span aria-hidden="true">·</span>
      <span>not production</span>
    </div>
  );
}
