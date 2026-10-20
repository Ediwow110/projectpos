import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller";
import { resolveBuildIdentity, shortCommit } from "./build-identity";

describe("build identity", () => {
  it("reports the commit, branch, service and hostname the platform provides", () => {
    const identity = resolveBuildIdentity({
      RENDER_GIT_COMMIT: "75e82628247b29d4cd7118df9c49fa8b1613dfcc",
      RENDER_GIT_BRANCH: "main",
      RENDER_SERVICE_NAME: "nexpos-h5-staging-api",
      RENDER_EXTERNAL_HOSTNAME: "nexpos-h5-staging-api.onrender.com",
    } as NodeJS.ProcessEnv);

    expect(identity).toEqual({
      sha: "75e82628247b29d4cd7118df9c49fa8b1613dfcc",
      branch: "main",
      service: "nexpos-h5-staging-api",
      hostname: "nexpos-h5-staging-api.onrender.com",
    });
  });

  it("never invents an identity when the platform provides none", () => {
    expect(resolveBuildIdentity({} as NodeJS.ProcessEnv)).toEqual({
      sha: null,
      branch: null,
      service: null,
      hostname: null,
    });
  });

  it("treats a blank value as absent rather than as an identity", () => {
    const identity = resolveBuildIdentity({
      RENDER_GIT_COMMIT: "   ",
      RENDER_GIT_BRANCH: "",
    } as NodeJS.ProcessEnv);

    expect(identity.sha).toBeNull();
    expect(identity.branch).toBeNull();
  });

  it("exposes the short commit form used in the environment banner", () => {
    expect(shortCommit("75e82628247b29d4cd7118df9c49fa8b1613dfcc")).toBe("75e8262");
    expect(shortCommit(null)).toBeNull();
  });
});

describe("public version endpoint", () => {
  it("serves the build identity without a session or a tenant", () => {
    const controller = new HealthController(null);
    let status = 0;
    let payload: unknown = null;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(body: unknown) {
        payload = body;
        return this;
      },
    };

    controller.version(res as never);

    expect(status).toBe(200);
    expect(payload).toMatchObject({ ok: true });
    expect((payload as { build: Record<string, unknown> }).build).toHaveProperty("sha");
    expect((payload as { build: Record<string, unknown> }).build).toHaveProperty("branch");
  });
});
