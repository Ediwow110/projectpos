import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";

import { createTestApp } from "../src/app.module";
import { AuthService } from "../src/auth/nest/auth.service";

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
});
