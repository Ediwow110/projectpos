import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/common/memory.db";
import { AuthService } from "../src/auth/nest/auth.service";

const FLAG = "AUTH_REQUIRE_EMAIL_VERIFICATION";

describe("phase11 email verification (FR-AUTH-01 when enabled)", () => {
  describe("flag off (default)", () => {
    it("registers and logs in with no verification gate", async () => {
      const db = createMemoryDb();
      const auth = new AuthService(db);
      const stamp = Date.now();
      const meta = { requestId: "r1", ip: null, userAgent: null };
      const reg = await auth.register(
        { ownerName: "O", email: `off-${stamp}@x.test`, password: "long-enough-pass", businessName: "B" },
        meta,
      );
      expect(reg.verificationToken).toBeUndefined();
      const login = await auth.login({ email: `off-${stamp}@x.test`, password: "long-enough-pass" }, meta);
      expect(login.token).toBeTruthy();
    });
  });

  describe("flag on", () => {
    beforeAll(() => { process.env[FLAG] = "1"; });
    afterAll(() => { delete process.env[FLAG]; });

    it("gates login until the token is redeemed", async () => {
      const db = createMemoryDb();
      const auth = new AuthService(db);
      const stamp = Date.now();
      const meta = { requestId: "r2", ip: null, userAgent: null };
      const reg = await auth.register(
        { ownerName: "O", email: `on-${stamp}@x.test`, password: "long-enough-pass", businessName: "B" },
        meta,
      );
      expect(typeof reg.verificationToken).toBe("string");
      await expect(
        auth.login({ email: `on-${stamp}@x.test`, password: "long-enough-pass" }, meta),
      ).rejects.toThrow("EMAIL_UNVERIFIED");
      await auth.verifyEmail(reg.verificationToken!);
      const login = await auth.login({ email: `on-${stamp}@x.test`, password: "long-enough-pass" }, meta);
      expect(login.token).toBeTruthy();
      // The token is single-use.
      await expect(auth.verifyEmail(reg.verificationToken!)).rejects.toThrow("VALIDATION");
    });
  });
});
