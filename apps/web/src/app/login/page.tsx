"use client";

import type { JSX } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "../../lib/api";
import { AtlasAuthBrandPanel } from "../../components/AtlasAuthBrandPanel";
import { loginWithReadiness } from "../../lib/login-flow";
import { isTransientReadinessError } from "../../lib/login-readiness";
import { persistActiveSyncScope } from "../../lib/sync-store";

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
    <main data-ui="atlas-v4-login" className="atlas-entry min-h-screen bg-[#f7f8f5] lg:grid lg:grid-cols-[535px_minmax(0,1fr)]">
      <AtlasAuthBrandPanel />
      <section className="relative min-w-0 px-5 py-10 sm:px-10 lg:min-h-screen lg:px-[82px] lg:pt-[128px]">

        <div className="animate-auth-card relative z-10 w-full max-w-[684px]">
          <p className="atlas-eyebrow">SIGN IN</p>
          <h2 className="font-display mt-11 text-[30px] font-semibold text-[#202826] sm:text-[33px]">Sign in to NexPOS</h2>
          <p className="mt-3 text-[16px] text-[#707b75]">Your workspace, right where you left it.</p>

          {verifiedNotice ? (
            <div className="animate-auth-status mt-5 rounded-xl border border-[#cde8da] bg-[#eaf7f0] px-4 py-3 text-[12px] font-medium text-[#1f6f4a]" role="status">
              Email verified. Sign in to continue setting up your business.
            </div>
          ) : null}

          <form onSubmit={submit} noValidate className="mt-14 space-y-4 lg:mt-[68px] lg:space-y-5">
            <label className="block text-[13px] font-medium text-[#707b75]">
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="you@business.com"
                autoComplete="email"
                className="field mt-2 !min-h-[55px]"
              />
            </label>
            <label className="block text-[13px] font-medium text-[#707b75]">
              Password
              <span className="relative mt-2 block">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  placeholder="Enter password"
                  autoComplete="current-password"
                  className="field !min-h-[55px] pr-16"
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

            {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[13px] font-medium text-[#c43e3e]">{error}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="auth-interactive atlas-primary mt-8 w-full !bg-[#202826] px-4 text-[15px] disabled:cursor-not-allowed disabled:opacity-65 lg:mt-[110px]"
            >
              {submitState === "connecting" ? "Connecting…" : submitLabel}
            </button>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-[14px] text-[#707b75]">
              <Link href="/password-reset" className="font-medium text-[#da614c] underline-offset-4 hover:underline">Forgot password?</Link>
              <span aria-hidden>•</span>
              <Link href="/register" className="font-semibold text-[#202826] underline-offset-4 hover:underline">Create account</Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
