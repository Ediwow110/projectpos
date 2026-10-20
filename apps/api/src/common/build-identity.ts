/**
 * Build identity of the running service.
 *
 * Render publishes the commit, branch, service name and public hostname of
 * the current deploy as `RENDER_*` environment variables, available at both
 * build time and runtime. Reading them here is what lets a deployed
 * environment state which build it is serving instead of leaving a reader to
 * guess from a deploy list.
 *
 * Nothing here is invented: when the platform does not publish a value the
 * field is null, so a local or non-Render run reports "unknown" rather than
 * a plausible-looking commit.
 */
export interface BuildIdentity {
  /** Full commit SHA of the deploy, or null when the platform publishes none. */
  sha: string | null;
  /** Branch the deploy was built from, or null. */
  branch: string | null;
  /** Render service name, or null. */
  service: string | null;
  /** Public hostname of the service, or null. */
  hostname: string | null;
}

function value(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

export function resolveBuildIdentity(env: NodeJS.ProcessEnv = process.env): BuildIdentity {
  return {
    sha: value(env, "RENDER_GIT_COMMIT"),
    branch: value(env, "RENDER_GIT_BRANCH"),
    service: value(env, "RENDER_SERVICE_NAME"),
    hostname: value(env, "RENDER_EXTERNAL_HOSTNAME"),
  };
}

/** The short commit form used in the environment banner. */
export function shortCommit(sha: string | null): string | null {
  if (sha === null) return null;
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}
