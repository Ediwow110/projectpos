import { describe, expect, it } from "vitest";

import { AuthService } from "../src/auth/nest/auth.service";
import { createMemoryDb } from "../src/common/memory.db";
import type { TransactionalEmailPort } from "../src/email/email.service";

class CaptureEmail implements TransactionalEmailPort {
  resets: Array<{ to: string; name: string; token: string }> = [];
  verifications: Array<{ to: string; name: string; token: string }> = [];

  async sendPasswordReset(input: { to: string; name: string; token: string }): Promise<void> {
    this.resets.push(input);
  }

  async sendEmailVerification(input: { to: string; name: string; token: string }): Promise<void> {
    this.verifications.push(input);
  }
}

describe("auth transactional email delivery", () => {
  it("delivers the password-reset credential only through the email port", async () => {
    const db = createMemoryDb();
    const email = new CaptureEmail();
    const auth = new AuthService(db, email);
    const address = `reset-mail-${Date.now()}@example.com`;
    await auth.register(
      { ownerName: "Reset Owner", email: address, password: "correct-horse-12", businessName: "Store" },
      { requestId: "reg", ip: null, userAgent: null },
    );

    const result = await auth.requestReset(address, { requestId: "reset", ip: "127.0.0.1" });

    expect(result.tokenForTest).toBeTruthy();
    expect(email.resets).toEqual([
      { to: address, name: "Reset Owner", token: result.tokenForTest },
    ]);
  });

  it("sends verification on registration and supports a generic resend", async () => {
    const previous = process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"];
    process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"] = "1";
    try {
      const db = createMemoryDb();
      const email = new CaptureEmail();
      const auth = new AuthService(db, email);
      const address = `verify-mail-${Date.now()}@example.com`;
      const registration = await auth.register(
        { ownerName: "Verify Owner", email: address, password: "correct-horse-12", businessName: "Store" },
        { requestId: "reg", ip: null, userAgent: null },
      );

      expect(registration.verificationRequired).toBe(true);
      expect(email.verifications).toHaveLength(1);
      expect(email.verifications[0]).toEqual({
        to: address,
        name: "Verify Owner",
        token: registration.verificationToken,
      });

      await auth.resendVerification(address, { requestId: "resend", ip: null });
      expect(email.verifications).toHaveLength(2);
      expect(email.verifications[1]!.token).not.toBe(email.verifications[0]!.token);

      await auth.resendVerification("missing@example.com", { requestId: "missing", ip: null });
      expect(email.verifications).toHaveLength(2);
    } finally {
      if (previous === undefined) delete process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"];
      else process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"] = previous;
    }
  });
});
