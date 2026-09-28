import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("pre-auth privacy presentation", () => {
  it("keeps the login landing page free of business metrics and identities", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");

    expect(source).toContain("Run the business.");
    expect(source).toContain("Keep the business private.");
    expect(source).toContain("Your operational data stays behind secure sign-in.");
    expect(source).not.toMatch(/₱\s*\d/);
    expect(source).not.toContain("Mabuhay Market");
    expect(source).not.toContain("owner@mabuhaymarket.ph");
    expect(source).not.toContain("cash variance");
  });

  it("makes account recovery discoverable from sign-in", () => {
    const login = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const reset = readFileSync(resolve(process.cwd(), "src/app/password-reset/page.tsx"), "utf8");

    expect(login).toContain('href="/password-reset"');
    expect(login).toContain("Forgot password?");
    expect(reset).toContain('href="/login"');
    expect(reset).toContain("Back to sign in");
  });

  it("makes account creation discoverable from sign-in", () => {
    const login = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");

    expect(login).toContain('href="/register"');
    expect(login).toContain("Create account");
  });

  it("keeps login and registration on the same auth layout grid", () => {
    const login = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const register = readFileSync(resolve(process.cwd(), "src/app/register/page.tsx"), "utf8");

    for (const source of [login, register]) {
      expect(source).toContain("lg:grid-cols-[1.08fr_.92fr]");
      expect(source).toContain("lg:mt-28");
      expect(source).toContain("min-h-[720px]");
      expect(source).toContain("h-[720px] w-[430px]");
      expect(source).toContain("max-w-[536px]");
    }
  });

  it("does not render redundant auth-page badge strips", () => {
    const login = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const register = readFileSync(resolve(process.cwd(), "src/app/register/page.tsx"), "utf8");

    expect(login).not.toContain("Encrypted session");
    expect(login).not.toContain("Role-based access");
    expect(login).not.toContain("Device visibility");
    expect(register).not.toContain("Business-scoped data");
    expect(register).not.toContain("Role-ready access");
    expect(register).not.toContain("Audited operations");
  });

  it("redirects an unauthorized dashboard visit to the login page", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

    expect(dashboard).toContain('router.replace("/login")');
    expect(dashboard).toMatch(/status === 401[\s\S]*status === 403/);
    expect(dashboard).not.toContain("Sign in required");
  });
});
