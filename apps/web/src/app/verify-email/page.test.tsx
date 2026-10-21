import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveChallengeLookup } from "./challenge-lookup";

describe("resolveChallengeLookup", () => {
  it("keeps an answered 'captcha disabled' answer as an answer", async () => {
    const lookup = await resolveChallengeLookup(async () => ({ enabled: false }));

    expect(lookup).toMatchObject({ status: "ready", enabled: false });
  });

  it("keeps an answered enabled config as an answer", async () => {
    const lookup = await resolveChallengeLookup(async () => ({ enabled: true, siteKey: "site-1" }));

    expect(lookup).toMatchObject({ status: "ready", enabled: true, siteKey: "site-1" });
  });

  it("does not report the captcha as disabled when the lookup never landed", async () => {
    const lookup = await resolveChallengeLookup(async () => {
      throw new Error("ECONNREFUSED");
    });

    // Before the fix this resolved as { enabled: false }, indistinguishable from a server
    // that genuinely turned Turnstile off.
    expect(lookup).toMatchObject({ status: "error" });
  });

  it("does not report the captcha as disabled when the lookup was refused", async () => {
    const lookup = await resolveChallengeLookup(async () => {
      throw Object.assign(new Error("Forbidden"), { name: "ApiError", status: 403, code: "FORBIDDEN" });
    });

    expect(lookup).toMatchObject({ status: "error" });
  });
});

/** The retryable branch lives inside the route module, which Next.js only allows to export
 *  the page itself, so it is guarded the way this repository guards other page internals:
 *  against the rendered source. */
describe("verify-email page wiring", () => {
  const source = readFileSync(resolve(process.cwd(), "src/app/verify-email/page.tsx"), "utf8");

  it("shows a retry for the failed lookup instead of the rate-limit note alone", () => {
    expect(source).toContain("challenge.status === \"error\"");
    expect(source).toContain("Retry verification check");
  });

  it("blocks resend while the challenge lookup is unknown", () => {
    expect(source).toContain("challenge.status === \"error\"");
    expect(source).not.toContain("setChallenge({ enabled: false })");
  });
});
