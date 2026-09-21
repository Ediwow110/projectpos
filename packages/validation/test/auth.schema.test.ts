import { describe, expect, it } from "vitest";
import {
  registerSchema,
  loginSchema,
  passwordResetConfirmSchema,
  onboardingPatchSchema,
} from "../src/auth.schema";

describe("phase1 auth schemas", () => {
  it("rejects weak password under 12 chars", () => {
    expect(() =>
      registerSchema.parse({
        ownerName: "Ana",
        email: "ana@example.com",
        password: "short1",
        businessName: "Sari Store",
      }),
    ).toThrow();
  });
  it("rejects invalid email", () => {
    expect(() =>
      loginSchema.parse({ email: "not-an-email", password: "longenoughpassword" }),
    ).toThrow();
  });
  it("rejects reset confirm with mismatched token shape", () => {
    expect(() =>
      passwordResetConfirmSchema.parse({ token: "", newPassword: "longenoughpassword" }),
    ).toThrow();
  });
  it("rejects unknown onboarding step", () => {
    expect(() =>
      onboardingPatchSchema.parse({ step: "unknown-step", state: "done" }),
    ).toThrow();
  });
  it("accepts valid registration payload", () => {
    const out = registerSchema.parse({
      ownerName: "Ana",
      email: "ana@example.com",
      password: "correct-horse-12",
      businessName: "Sari Store",
    });
    expect(out.email).toBe("ana@example.com");
  });
});
