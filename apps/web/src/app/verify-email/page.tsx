"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { TurnstileWidget } from "../../components/TurnstileWidget";
import { ApiError, apiFetch } from "../../lib/api";

type ChallengeConfig = { enabled: boolean; siteKey?: string };

export default function VerifyEmailPage(): JSX.Element {
  const router = useRouter();
  const started = useRef(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("Check your inbox for a verification link.");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [challenge, setChallenge] = useState<ChallengeConfig | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaEpoch, setCaptchaEpoch] = useState(0);

  useEffect(() => {
    const remembered = window.sessionStorage.getItem("nexpos-verification-email") ?? "";
    setEmail(remembered);
    void apiFetch<ChallengeConfig>("/api/v1/auth/verify-email/challenge")
      .then((config) => setChallenge(config))
      .catch(() => setChallenge({ enabled: false }));

    const token = new URLSearchParams(window.location.search).get("token");
    if (!token || started.current) return;
    started.current = true;
    setVerifying(true);
    setMessage("Verifying your email…");
    void apiFetch<{ verified: true }>("/api/v1/auth/verify-email", {
      init: { method: "POST", body: JSON.stringify({ token }) },
    })
      .then(() => {
        window.sessionStorage.removeItem("nexpos-verification-email");
        setVerified(true);
        setMessage("Email verified. Your NexPOS workspace is ready.");
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Verification failed");
        setMessage("");
      })
      .finally(() => setVerifying(false));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  function resetCaptcha(): void {
    setCaptchaToken("");
    setCaptchaEpoch((value) => value + 1);
  }

  async function resend(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (sending || cooldown > 0) return;
    setError("");
    if (challenge?.enabled && !captchaToken) {
      setError("Complete the human verification challenge before resending.");
      return;
    }
    setSending(true);
    try {
      const result = await apiFetch<{ message: string }>("/api/v1/auth/verify-email/resend", {
        init: {
          method: "POST",
          body: JSON.stringify({ email, ...(captchaToken ? { captchaToken } : {}) }),
        },
      });
      window.sessionStorage.setItem("nexpos-verification-email", email);
      setMessage(result.message);
      setCooldown(60);
      resetCaptcha();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Could not resend verification email");
      resetCaptcha();
    } finally {
      setSending(false);
    }
  }

  const resendDisabled = sending || cooldown > 0 || challenge === null || Boolean(challenge?.enabled && !captchaToken);

  return (
    <main className="min-h-screen overflow-hidden bg-[#fcf8f3] text-[#211814] lg:grid lg:grid-cols-[1.08fr_.92fr]">
      <section className="relative overflow-hidden bg-[#161411] px-6 py-8 text-white sm:px-10 lg:min-h-screen lg:px-14 lg:py-12">
        <span aria-hidden className="absolute inset-y-0 left-0 w-2.5 bg-[#f35d3f]" />
        <div aria-hidden className="animate-auth-glow absolute -right-24 top-24 h-72 w-72 rounded-full bg-[#f35d3f]/10 blur-3xl" />

        <div className="relative z-10 flex items-center gap-4">
          <div className="font-display grid h-11 w-11 place-items-center rounded-[9px] bg-[#f35d3f] text-lg font-bold">N</div>
          <div>
            <p className="font-display text-[22px] font-bold leading-none">NEXPOS</p>
            <p className="font-data mt-2 text-[9px] font-medium tracking-[0.14em] text-[#a79e94]">ACCOUNT SECURITY</p>
          </div>
        </div>

        <div className="animate-auth-copy relative z-10 mx-auto mt-20 max-w-[650px] lg:mt-32">
          <p className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[#ff8061]">One last security step</p>
          <h1 className="font-display mt-5 text-[38px] font-bold leading-[1.12] tracking-[-0.035em] sm:text-[44px]">
            Verify the address.
            <span className="block">Protect the workspace.</span>
          </h1>
          <p className="mt-6 max-w-[580px] text-[15px] leading-6 text-[#a79e94] sm:text-[16px]">
            Email verification keeps owner access tied to a reachable address before business data becomes available.
          </p>

          <div className="mt-10 overflow-hidden rounded-[14px] border border-[#3a332d] bg-[#1e1b18] shadow-[0_18px_42px_-14px_rgb(0_0_0/0.34)]">
            {[
              ["01", "Check your inbox", "Open the latest NexPOS verification email"],
              ["02", "Verify securely", "The verification link is single-use and time-limited"],
              ["03", "Continue setup", "Return to onboarding after confirmation"],
            ].map(([step, title, detail]) => (
              <div key={step} className="grid grid-cols-[38px_minmax(0,1fr)] items-center gap-3 border-b border-[#302b27] px-5 py-4 last:border-b-0">
                <span className="font-data grid h-8 w-8 place-items-center rounded-[8px] bg-[#4a2118] text-[9px] font-semibold text-[#ff8061]">{step}</span>
                <div>
                  <p className="text-[12px] font-semibold">{title}</p>
                  <p className="mt-1 text-[10px] text-[#a79e94]">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative grid min-h-[720px] place-items-center overflow-hidden p-5 sm:p-10 lg:min-h-screen">
        <div aria-hidden className="animate-auth-glow pointer-events-none absolute left-1/2 top-1/2 h-[720px] w-[430px] -translate-x-1/2 -translate-y-1/2 rounded-[28px] bg-[#f7f1ea]" />

        <section className="animate-auth-card relative z-10 w-full max-w-[536px] rounded-[14px] border border-[#eee4db] bg-white p-6 shadow-[0_18px_48px_-14px_rgb(22_18_14/0.14)] sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-data text-[9px] font-medium uppercase tracking-[0.14em] text-[#e44e34]">Secure account activation</p>
              <h2 className="font-display mt-5 text-[30px] font-bold text-[#17130f]">Verify your email</h2>
            </div>
            <div className={`animate-auth-status grid h-11 w-11 shrink-0 place-items-center rounded-full ${verified ? "bg-[#eaf7f0] text-[#1f8a5b]" : "bg-[#fff0ea] text-[#e44e34]"}`} aria-hidden>
              {verified ? "✓" : verifying ? "…" : "✦"}
            </div>
          </div>

          {message ? (
            <div className="mt-5 rounded-xl border border-[#eee4db] bg-[#fcf8f3] px-4 py-3.5 text-[13px] leading-5 text-[#6f625b] transition-all duration-300">
              {message}
            </div>
          ) : null}
          {error ? <p className="animate-auth-status mt-5 rounded-xl bg-[#fff1ee] px-4 py-3 text-sm text-[#9d2f1e]" role="alert">{error}</p> : null}

          {verified ? (
            <div className="mt-7 space-y-3">
              <button
                className="auth-interactive min-h-[52px] w-full rounded-[9px] bg-[#f35d3f] px-5 py-3 font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30]"
                onClick={() => router.push("/onboarding")}
              >
                Continue to onboarding
              </button>
              <p className="text-center text-[11px] text-[#73685f]">Verification complete. You can safely continue setup.</p>
            </div>
          ) : (
            <form onSubmit={resend} className="mt-7 space-y-4">
              <label className="block text-[12px] font-semibold text-[#655b53]">
                Email
                <input
                  className="field mt-2 !min-h-[54px]"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="owner@company.com"
                />
              </label>

              {challenge === null ? (
                <div className="h-[72px] animate-pulse rounded-xl bg-[#f7f1ea]" aria-label="Loading human verification" />
              ) : challenge.enabled && challenge.siteKey ? (
                <div className="rounded-xl border border-[#eee4db] bg-[#fcf8f3] p-3 transition-all duration-300">
                  <p className="mb-2 text-[10px] font-medium text-[#73685f]">Human verification</p>
                  <TurnstileWidget
                    key={captchaEpoch}
                    siteKey={challenge.siteKey}
                    action="verify_email_resend"
                    onToken={setCaptchaToken}
                    onExpire={() => setCaptchaToken("")}
                    onError={() => {
                      setCaptchaToken("");
                      setError("Human verification could not load. Refresh and try again.");
                    }}
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-[#eee4db] bg-[#f7f1ea] px-4 py-3 text-[11px] text-[#73685f]">
                  Resend protection is using the server rate limit. Turnstile can be enabled from deployment settings.
                </div>
              )}

              <button
                className="auth-interactive min-h-[52px] w-full rounded-[9px] border border-[#f35d3f] bg-white px-5 py-3 font-semibold text-[#b94029] shadow-[0_8px_20px_-12px_rgb(243_93_63/0.4)] hover:bg-[#fff8f5] disabled:cursor-not-allowed disabled:border-[#e4d9d0] disabled:bg-[#f7f1ea] disabled:text-[#9a8d83] disabled:shadow-none"
                type="submit"
                disabled={resendDisabled}
              >
                {sending ? "Sending…" : cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend verification email"}
              </button>
              <p className="text-center text-[10px] leading-4 text-[#9a8d83]">
                For your security, resend attempts are rate-limited and may require a human verification challenge.
              </p>
            </form>
          )}

          {!verified ? (
            <div className="mt-6 border-t border-[#eee4db] pt-5 text-center">
              <Link href="/login" className="text-[11px] font-semibold text-[#e44e34] transition hover:text-[#c63d27]">Back to sign in</Link>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
