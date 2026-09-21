import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, checkPasswordPolicy } from "../src/auth/password";

describe("argon2id passwords", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("correct-horse-12");
    expect(await verifyPassword(hash, "correct-horse-12")).toBe(true);
  });
  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct-horse-12");
    expect(await verifyPassword(hash, "wrong-password-99")).toBe(false);
  });
  it("rejects short password by policy", () => {
    expect(() => checkPasswordPolicy("short1")).toThrow("AUTH_WEAK_PASSWORD");
  });
  it("accepts 12+ char password", () => {
    expect(() => checkPasswordPolicy("correct-horse-12")).not.toThrow();
  });
});
