"use client";

import type { JSX } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "../../lib/api";
import { AtlasEntryBrand } from "../../components/AtlasEntryBrand";
import { loginWithReadiness } from "../../lib/login-flow";
import { isTransientReadinessError } from "../../lib/login-readiness";
import { persistActiveSyncScope } from "../../lib/sync-store";

const FEATURES = [
  ["Fast checkout", "Optimized for scan + keyboard"],
  ["Inventory clarity", "Exact stock, clear exceptions"],
  ["Cash control", "Audited shift close workflow"],
] as const;

const PRIVACY_ROWS = [
  ["Business data", "Hidden until sign-in", "Protected"],
  ["Team access", "Role-based permissions", "Controlled"],
  ["Audit activity", "Recorded after access", "Traceable"],
] as const;

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verifiedNotice, setVerifiedNotice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "connecting" | "signing-in">("idle");
  const submitLabel = submitting ? "Signing in…" : "Sign in securely";

  useEffect(() => {
    setVerifiedNotice(new URLSearchParams(window.location.search).get("verified") === "1");
  }, []);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    setSubmitState("connecting");
    let readinessComplete = false;
    try {
      const deviceId = window.localStorage.getItem("pos-device-id");
      const result = await loginWithReadiness({
        onReady: () => {
          readinessComplete = true;
          setSubmitState("signing-in");
        },
        login: () => apiFetch<{ userId: string; businessId: string; onboardingRequired: boolean }>("/api/v1/auth/login", {
          init: {
            method: "POST",
            body: JSON.stringify({ email, password, ...(deviceId ? { deviceId } : {}) }),
          },
        }),
      });
      persistActiveSyncScope({ userId: result.userId, businessId: result.businessId });
      queryClient.clear();
      router.push(result.onboardingRequired ? "/onboarding" : "/");
    } catch (err) {
      if (!readinessComplete) {
        setError(isTransientReadinessError(err) ? "The service is still starting. Try again." : err instanceof ApiError ? err.code + ": " + err.message : "Could not reach the service. Try again.");
      } else if (err instanceof ApiError && isTransientReadinessError(err)) {
        setError("Sign-in response was interrupted. Try again.");
      } else {
        setError(err instanceof ApiError ? err.code + ": " + err.message : "Login failed");
      }
      if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.code === "AUTH_INVALID_CREDENTIALS")) {
        setPassword("");
      }
      setSubmitting(false);
      setSubmitState("idle");
    }
  }

  return (
    <main data-ui="atlas-v4-login" className="atlas-entry min-h-screen lg:grid lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1fr)]">
      <section className="relative overflow-hidden border-b border-[#e5e9e3] bg-white px-6 py-7 text-[#202826] sm:px-10 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-14 lg:py-10">

        <div className="relative z-10 flex items-center gap-4">
          <AtlasEntryBrand />
        </div>

        <div className="animate-auth-copy relative z-10 mx-auto mt-12 max-w-[650px] lg:mt-24">
          <p className="atlas-eyebrow">
            Private by default · Ready for every shift
          </p>
          <h1 className="font-display mt-5 text-[38px] font-semibold leading-[1.12] tracking-[-0.035em] sm:text-[44px]">
            Run the business.
            <span className="block">Keep the business private.</span>
          </h1>
          <p className="mt-6 max-w-[600px] text-[15px] leading-7 text-[#748078] sm:text-[16px]">
            Your operational data stays behind secure sign-in. The landing experience shows the product — never your sales, cash, customer, or inventory figures.
          </p>

          <div className="mt-9 grid gap-3 rounded-xl border border-[#e5e9e3] bg-[#fbfcfa] p-4 sm:grid-cols-3">
            {FEATURES.map(([title, description], index) => (
              <div key={title} className="min-w-0 p-1">
                <p className="font-data text-[11px] font-medium tracking-[0.08em] text-[#da614c]">0{index + 1}</p>
                <p className="mt-3 text-[12px] font-semibold">{title}</p>
                <p className="mt-2 text-[12px] leading-5 text-[#748078]">{description}</p>
              </div>
            ))}
          </div>

          <section className="mt-7 overflow-hidden rounded-xl border border-[#e5e9e3] bg-white">
            <div className="flex items-center justify-between gap-4 bg-[#fbfcfa] px-5 py-4">
              <p className="font-data text-[10px] font-medium tracking-[0.12em]">PROTECTED WORKSPACE</p>
              <span className="rounded-md bg-[#e8f4ec] px-3 py-1.5 font-data text-[10px] font-medium text-[#267552]">SECURE</span>
            </div>
            <div className="divide-y divide-[#e5e9e3] px-5">
              {PRIVACY_ROWS.map(([label, description, state], index) => (
                <div key={label} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 py-4">
                  <span aria-hidden className={"grid h-7 w-7 place-items-center rounded-[7px] font-data text-[10px] " + (index === 0 ? "bg-[#fff0eb] text-[#da614c]" : "bg-[#f7f8f5] text-[#748078]")}>
                    {index === 0 ? "◆" : index === 1 ? "◇" : "•"}
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold">{label}</p>
                    <p className="mt-1 text-[11px] text-[#748078]">{description}</p>
                  </div>
                  <span className="font-data text-[10px] font-medium text-[#267552]">{state}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

      </section>

      <section className="relative grid min-h-[620px] place-items-center p-5 sm:p-10 lg:min-h-screen">

        <div className="animate-auth-card atlas-panel relative z-10 w-full max-w-[536px] p-6 sm:p-9">
          <p className="atlas-eyebrow">SECURE BUSINESS ACCESS</p>
          <h2 className="font-display mt-5 text-[30px] font-semibold text-[#202826]">Welcome back</h2>
          <p className="mt-2 text-sm text-[#73685f]">Sign in to open your secure workspace.</p>

          {verifiedNotice ? (
            <div className="animate-auth-status mt-5 rounded-xl border border-[#cde8da] bg-[#eaf7f0] px-4 py-3 text-[12px] font-medium text-[#1f6f4a]" role="status">
              Email verified. Sign in to continue setting up your business.
            </div>
          ) : null}

          <div className="mt-6 flex items-center gap-3 rounded-lg border border-[#e5e9e3] bg-[#fbfcfa] p-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f35d3f] font-data text-xs text-white">◆</div>
            <div>
              <p className="text-[12px] font-semibold text-[#2a241f]">Private workspace</p>
              <p className="mt-1 text-[10px] text-[#73685f]">Your business data appears only after authentication</p>
            </div>
          </div>

          <form onSubmit={submit} noValidate className="mt-6 space-y-4">
            <label className="block text-[12px] font-semibold text-[#655b53]">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="name@company.com"
                autoComplete="email"
                className="field mt-2 !min-h-[54px]"
              />
            </label>
            <label className="block text-[12px] font-semibold text-[#655b53]">
              Password
              <span className="relative mt-2 block">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  className="field !min-h-[54px] pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#e44e34]"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>

            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-[#8d8178]">Can’t access your account?</span>
              <Link
                href="/password-reset"
                className="font-semibold text-[#e44e34] underline-offset-4 transition hover:text-[#c33e29] hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f35d3f] focus-visible:ring-offset-2"
              >
                Forgot password?
              </Link>
            </div>

            {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[13px] font-medium text-[#c43e3e]">{error}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="auth-interactive atlas-primary w-full px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-65"
            >
              {submitState === "connecting" ? "Connecting…" : submitLabel}
            </button>
            <div className="flex items-center gap-3 py-1" aria-hidden>
              <span className="h-px flex-1 bg-[#eee4db]" />
              <span className="font-data text-[9px] font-medium uppercase tracking-[0.12em] text-[#9a8d83]">New to NexPOS?</span>
              <span className="h-px flex-1 bg-[#eee4db]" />
            </div>
            <Link
              href="/register"
              className="auth-interactive inline-flex min-h-[52px] w-full items-center justify-center rounded-[9px] border border-[#e4d9d0] bg-white px-4 text-[13px] font-semibold text-[#2a241f] hover:border-[#f35d3f] hover:bg-[#fff8f5] hover:text-[#d94a30] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f35d3f] focus-visible:ring-offset-2"
            >
              Create account
            </Link>
            <p className="font-data text-[9px] text-[#9a8d83]">Press Enter to continue</p>
          </form>

          <div className="mt-6 border-t border-[#eee4db] pt-5">
            <div className="rounded-lg border border-[#e5e9e3] bg-[#fbfcfa] p-4">
              <p className="text-[11px] font-semibold text-[#2a241f]">Your session stays business-scoped</p>
              <p className="mt-2 text-[10px] text-[#73685f]">Secure sign-in · device visibility · role-based access</p>
            </div>
          </div>
        </div>

        <p className="relative z-10 mt-5 max-w-lg text-center font-data text-[8px] leading-4 text-[#9a8d83]">
          No business metrics or customer data are shown before secure sign-in.
        </p>
      </section>
    </main>
  );
}
