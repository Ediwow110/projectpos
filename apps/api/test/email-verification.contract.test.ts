import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";

import { createTestApp } from "../src/app.module";
import { AuthService } from "../src/auth/nest/auth.service";
import type { HumanVerificationPort } from "../src/common/human-verification";

describe("email-verification session gate", () => {
  let app: INestApplication;
  let previousFlag: string | undefined;

  beforeAll(async () => {
    previousFlag = process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"];
    process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"] = "1";
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    if (previousFlag === undefined) delete process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"];
    else process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"] = previousFlag;
  });

  it("blocks the registration session until the email token is redeemed", async () => {
    const auth = app.get(AuthService);
    const email = `verify-session-${Date.now()}@example.com`;
    const registration = await auth.register(
      {
        ownerName: "Verify Owner",
        email,
        password: "correct-horse-12",
        businessName: "Verify Store",
      },
      { requestId: "verify-register", ip: null, userAgent: null },
    );
    expect(registration.verificationToken).toBeTruthy();

    const before = await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Cookie", `pos_session=${registration.token}`);
    expect(before.status).not.toBe(200);

    await auth.verifyEmail(registration.verificationToken!);

    const after = await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Cookie", `pos_session=${registration.token}`);
    expect(after.status).toBe(200);
    expect(after.body.email).toBe(email);
  });

  it("tells the registration UI verification is required without exposing the token", async () => {
    const email = `verify-http-${Date.now()}@example.com`;
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        ownerName: "HTTP Verify",
        email,
        password: "correct-horse-12",
        businessName: "HTTP Verify Store",
      });

    expect(response.status).toBe(201);
    expect(response.body.verificationRequired).toBe(true);
    expect(response.body).not.toHaveProperty("verificationToken");
  });

  it("resend stays generic for both existing and missing accounts", async () => {
    const existing = `verify-resend-${Date.now()}@example.com`;
    await app.get(AuthService).register(
      {
        ownerName: "Resend Verify",
        email: existing,
        password: "correct-horse-12",
        businessName: "Resend Store",
      },
      { requestId: "resend-register", ip: null, userAgent: null },
    );

    const first = await request(app.getHttpServer())
      .post("/api/v1/auth/verify-email/resend")
      .send({ email: existing });
    const second = await request(app.getHttpServer())
      .post("/api/v1/auth/verify-email/resend")
      .send({ email: `missing-${Date.now()}@example.com` });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.message).toBe(second.body.message);
    expect(first.body).not.toHaveProperty("token");
    expect(second.body).not.toHaveProperty("token");
  });

  it("requires a valid human-verification token when resend protection is enabled", async () => {
    const protectedApp = await createTestApp({
      humanVerification: {
        enabled: true,
        siteKey: "test-site-key",
        async verify(input) {
          return input.token === "valid-human-token" && input.action === "verify_email_resend";
        },
      } satisfies HumanVerificationPort,
    });

    try {
      const missing = await request(protectedApp.getHttpServer())
        .post("/api/v1/auth/verify-email/resend")
        .send({ email: "person@example.com" });
      const invalid = await request(protectedApp.getHttpServer())
        .post("/api/v1/auth/verify-email/resend")
        .send({ email: "person@example.com", captchaToken: "invalid" });
      const valid = await request(protectedApp.getHttpServer())
        .post("/api/v1/auth/verify-email/resend")
        .send({ email: "person@example.com", captchaToken: "valid-human-token" });

      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe("CAPTCHA_REQUIRED");
      expect(invalid.status).toBe(400);
      expect(invalid.body.code).toBe("CAPTCHA_FAILED");
      expect(valid.status).toBe(201);
    } finally {
      await protectedApp.close();
    }
  });
});
