import { describe, expect, it, vi } from "vitest";
import { deployEnvironment, fetchBuildInfo, resolveWebBuildIdentity } from "./build-info";

describe("web build identity", () => {
  it("reports the commit, branch, service and hostname of the running deploy", () => {
    const identity = resolveWebBuildIdentity({
      RENDER_GIT_COMMIT: "1d36d748d6b187307372ae40e89d6a459d39c502",
      RENDER_GIT_BRANCH: "main",
      RENDER_SERVICE_NAME: "nexpos-h5-staging-web",
      RENDER_EXTERNAL_HOSTNAME: "nexpos-h5-staging-web.onrender.com",
      DEPLOY_ENV: "staging",
    });

    expect(identity).toEqual({
      sha: "1d36d748d6b187307372ae40e89d6a459d39c502",
      branch: "main",
      service: "nexpos-h5-staging-web",
      hostname: "nexpos-h5-staging-web.onrender.com",
      environment: "Staging",
    });
  });

  it("never invents an identity when the platform provides none", () => {
    expect(resolveWebBuildIdentity({})).toEqual({
      sha: null,
      branch: null,
      service: null,
      hostname: null,
      environment: null,
    });
  });

  it("treats a blank value as absent", () => {
    const identity = resolveWebBuildIdentity({
      RENDER_GIT_COMMIT: "   ",
    });

    expect(identity.sha).toBeNull();
  });

  it("never labels a production deploy as an environment banner", () => {
    expect(deployEnvironment({ DEPLOY_ENV: "production" })).toBeNull();
    expect(deployEnvironment({ DEPLOY_ENV: "PRODUCTION" })).toBeNull();
  });

  it("leaves an unlabelled environment without a banner", () => {
    expect(deployEnvironment({})).toBeNull();
    expect(deployEnvironment({ DEPLOY_ENV: "   " })).toBeNull();
  });

  it("capitalises the environment label for display", () => {
    expect(deployEnvironment({ DEPLOY_ENV: "staging" })).toBe("Staging");
    expect(deployEnvironment({ DEPLOY_ENV: "preview" })).toBe("Preview");
  });
});

describe("build info fetch", () => {
  it("asks the service which build it is serving", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, build: resolveWebBuildIdentity({ DEPLOY_ENV: "staging" }) }),
    }));

    const identity = await fetchBuildInfo(fetcher as unknown as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith("/api/build-info", expect.anything());
    expect(identity?.environment).toBe("Staging");
  });

  it("reports no identity when the service cannot answer", async () => {
    const failing = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await fetchBuildInfo(failing as unknown as typeof fetch)).toBeNull();

    const throwing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await fetchBuildInfo(throwing as unknown as typeof fetch)).toBeNull();
  });
});
