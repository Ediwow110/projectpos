/**
 * Build identity of the running web service.
 *
 * The web pages are statically prerendered, so a value read at build time
 * would be frozen into the HTML and could go stale. Reading the identity at
 * request time keeps it truthful: it always describes the deploy that is
 * actually serving.
 *
 * Render publishes these values for the current deploy, and the platform
 * does not provide them outside Render, so every field is null when it is
 * unknown. Nothing here is invented.
 */
export interface WebBuildIdentity {
  sha: string | null;
  branch: string | null;
  service: string | null;
  hostname: string | null;
  /** The deploy environment label, e.g. "staging". Null when unlabelled. */
  environment: string | null;
}

/**
 * The environment source. Next.js augments `NodeJS.ProcessEnv` with a
 * required NODE_ENV, so a plain record is the honest shape for a partial
 * environment.
 */
type EnvironmentSource = Record<string, string | undefined>;

function value(env: EnvironmentSource, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The environment label, normalised. Production is always null so the
 * banner can never appear there, whatever the variable is set to.
 */
export function deployEnvironment(env: EnvironmentSource = process.env): string | null {
  const raw = value(env, "DEPLOY_ENV");
  if (raw === null) return null;
  if (raw.toLowerCase() === "production") return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function resolveWebBuildIdentity(env: EnvironmentSource = process.env): WebBuildIdentity {
  return {
    sha: value(env, "RENDER_GIT_COMMIT"),
    branch: value(env, "RENDER_GIT_BRANCH"),
    service: value(env, "RENDER_SERVICE_NAME"),
    hostname: value(env, "RENDER_EXTERNAL_HOSTNAME"),
    environment: deployEnvironment(env),
  };
}

/**
 * Reads the identity this service is serving. The banner uses it so the
 * environment it names is the environment that is actually running, not one
 * frozen into the prerendered page.
 */
export async function fetchBuildInfo(
  fetcher: typeof fetch = fetch,
  path = "/api/build-info",
): Promise<WebBuildIdentity | null> {
  try {
    const response = await fetcher(path, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean; build?: WebBuildIdentity };
    if (!body || body.ok !== true || !body.build) return null;
    return body.build;
  } catch {
    return null;
  }
}
