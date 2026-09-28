import { describe, expect, it, vi } from "vitest";

import { createHumanVerificationFromEnv } from "./human-verification";

describe("Turnstile human verification", () => {
  it("stays disabled when no Turnstile keys are configured", () => {
    const verifier = createHumanVerificationFromEnv({}, vi.fn() as unknown as typeof fetch);

    expect(verifier.enabled).toBe(false);
    expect(verifier.siteKey).toBeNull();
  });

  it("validates the token, action, and expected hostname server-side", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, action: "verify_email_resend", hostname: "nexpos-web.onrender.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const verifier = createHumanVerificationFromEnv(
      {
        TURNSTILE_SITE_KEY: "site-key",
        TURNSTILE_SECRET_KEY: "secret-key",
        WEB_URL: "https://nexpos-web.onrender.com",
      },
      fetchImpl,
    );

    await expect(verifier.verify({ token: "browser-token", ip: "203.0.113.5", action: "verify_email_resend" })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails closed when Turnstile rejects the token", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const verifier = createHumanVerificationFromEnv(
      { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: "secret-key" },
      fetchImpl,
    );

    await expect(verifier.verify({ token: "bad-token", ip: null, action: "verify_email_resend" })).resolves.toBe(false);
  });
});
