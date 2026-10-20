import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("pre-auth privacy presentation", () => {
  it("keeps the login landing page free of business metrics and identities", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const identity = readFileSync(resolve(process.cwd(), "src/components/AtlasAuthBrandPanel.tsx"), "utf8");

    expect(identity).toContain("Retail,");
    expect(identity).toContain("under control.");
    expect(identity).toContain("Security and simplicity for every shift.");
    expect(identity).toContain("No private business metrics or customer details are shown before sign-in.");
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

  it("keeps login and registration aligned to the Figma V4 auth layout", () => {
    const login = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const register = readFileSync(resolve(process.cwd(), "src/app/register/page.tsx"), "utf8");
    const identity = readFileSync(resolve(process.cwd(), "src/components/AtlasAuthBrandPanel.tsx"), "utf8");

    for (const source of [login, register]) {
      expect(source).toContain("lg:grid-cols-[535px_minmax(0,1fr)]");
      expect(source).toContain("AtlasAuthBrandPanel");
      expect(source).toContain("lg:min-h-screen");
      expect(source).toContain("animate-auth-card");
      expect(source).toContain("max-w-[684px]");
      expect(source).toContain("lg:px-[82px]");
    }
    expect(identity).toContain("AtlasEntryBrand");
    expect(identity).toContain("animate-auth-copy");
    expect(identity).toContain("bg-[#fff0eb]");
    expect(login).toContain("you@business.com");
    expect(login).toContain("Sign in to NexPOS");
    expect(register).toContain("owner@store.com");
    expect(register).toContain("Business name");
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

  it("protects verification resends with Turnstile and polished motion states", () => {
    const verify = readFileSync(resolve(process.cwd(), "src/app/verify-email/page.tsx"), "utf8");

    expect(verify).toContain("TurnstileWidget");
    expect(verify).toContain("captchaToken");
    expect(verify).toContain("Resend available in");
    expect(verify).toContain("animate-auth-card");
    expect(verify).toContain("Sending…");
  });

  it("requires a fresh login after email verification before onboarding", () => {
    const verify = readFileSync(resolve(process.cwd(), "src/app/verify-email/page.tsx"), "utf8");
    const login = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const register = readFileSync(resolve(process.cwd(), "src/app/register/page.tsx"), "utf8");

    expect(verify).toContain('router.replace("/login?verified=1")');
    expect(verify).not.toContain("Continue to onboarding");
    expect(verify).toContain("Sign in to continue setup");
    expect(verify).not.toContain("Return to onboarding after confirmation");
    expect(login).toContain("onboardingRequired");
    expect(login).toContain('router.push(result.onboardingRequired ? "/onboarding" : "/")');
    expect(login).toContain("Email verified");
    expect(register).toContain("clearActiveSyncScope");
  });

  it("prevents duplicate login submissions and keeps the submit geometry stable", () => {
    const login = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");

    expect(login).toContain("const [submitting, setSubmitting] = useState(false)");
    expect(login).toContain("if (submitting) return");
    expect(login).toContain("disabled={submitting}");
    expect(login).toContain('aria-busy={submitting}');
    expect(login).toContain('submitting ? "Signing in…" : "Sign in securely"');
  });

  it("keeps password recovery on the canonical auth layout with explicit busy states", () => {
    const reset = readFileSync(resolve(process.cwd(), "src/app/password-reset/page.tsx"), "utf8");

    expect(reset).toContain("lg:grid-cols-[1.08fr_.92fr]");
    expect(reset).toContain("animate-auth-copy");
    expect(reset).toContain("animate-auth-card");
    expect(reset).toContain("const [requesting, setRequesting] = useState(false)");
    expect(reset).toContain("const [resendCooldown, setResendCooldown] = useState(0)");
    expect(reset).toContain("`Resend available in ${resendCooldown}s`");
    expect(reset).toContain("const [confirming, setConfirming] = useState(false)");
    expect(reset).toContain("Sending reset link…");
    expect(reset).toContain("Updating password…");
  });

  it("uses app-owned validation feedback across the touched auth forms", () => {
    const login = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const verify = readFileSync(resolve(process.cwd(), "src/app/verify-email/page.tsx"), "utf8");
    const reset = readFileSync(resolve(process.cwd(), "src/app/password-reset/page.tsx"), "utf8");

    expect(login).toContain("<form onSubmit={submit} noValidate");
    expect(verify).toContain("<form onSubmit={resend} noValidate");
    expect(reset).toContain("<form onSubmit={requestReset} noValidate");
    expect(reset).toContain("<form onSubmit={confirmReset} noValidate");
  });

  it("sends a CSRF token with onboarding mutations", () => {
    const onboarding = readFileSync(resolve(process.cwd(), "src/app/onboarding/page.tsx"), "utf8");

    expect(onboarding).toContain('apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf")');
    expect(onboarding).toContain("csrfToken: csrf.csrfToken");
  });

  it("redirects an unauthorized dashboard visit to the login page", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

    expect(dashboard).toContain('router.replace("/login")');
    expect(dashboard).toMatch(/status === 401[\s\S]*status === 403/);
    expect(dashboard).not.toContain("Sign in required");
  });
});
