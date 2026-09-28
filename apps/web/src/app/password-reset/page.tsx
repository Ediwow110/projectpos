"use client";

import type { JSX } from "react";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ApiError, apiFetch } from "../../lib/api";

const RECOVERY_STEPS = [
  ["01", "Request securely", "Use the email address tied to the owner account"],
  ["02", "Open the reset link", "Reset links are time-limited and single-purpose"],
  ["03", "Set a new password", "Use at least 12 characters before signing in again"],
] as const;

export default function PasswordResetPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("token");
    if (fromLink) setToken(fromLink);
  }, []);

  async function requestReset(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (requesting) return;
    setError("");
    setMessage("");
    setRequesting(true);
    try {
      const res = await apiFetch<{ message: string }>("/api/v1/auth/password-reset/request", {
        init: { method: "POST", body: JSON.stringify({ email }) },
      });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Request failed");
    } finally {
      setRequesting(false);
    }
  }

  async function confirmReset(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (confirming) return;
    setError("");
    setMessage("");
    setConfirming(true);
    try {
      await apiFetch("/api/v1/auth/password-reset/confirm", {
        init: { method: "POST", body: JSON.stringify({ token, newPassword }) },
      });
      setNewPassword("");
      setMessage("Password updated. You can sign in now.");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Reset failed");
    } finally {
      setConfirming(false);
    }
  }

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

        <div className="animate-auth-copy relative z-10 mx-auto mt-16 max-w-[650px] lg:mt-28">
          <p className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[#ff8061]">
            Secure account recovery
          </p>
          <h1 className="font-display mt-5 text-[38px] font-bold leading-[1.12] tracking-[-0.035em] sm:text-[44px]">
            Recover access.
            <span className="block">Keep the workspace protected.</span>
          </h1>
          <p className="mt-6 max-w-[590px] text-[15px] leading-6 text-[#a79e94] sm:text-[16px]">
            Reset access without exposing whether an account exists. NexPOS keeps recovery links short-lived and revokes existing sessions after a successful password change.
          </p>

          <div className="mt-10 overflow-hidden rounded-[14px] border border-[#3a332d] bg-[#1e1b18] shadow-[0_18px_42px_-14px_rgb(0_0_0/0.34)]">
            {RECOVERY_STEPS.map(([step, title, detail]) => (
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
          <p className="font-data text-[9px] font-medium uppercase tracking-[0.14em] text-[#e44e34]">
            {token ? "Choose a new password" : "Recover secure access"}
          </p>
          <h2 className="font-display mt-5 text-[30px] font-bold text-[#17130f]">Reset password</h2>
          <p className="mt-2 text-sm leading-5 text-[#73685f]">
            {token
              ? "Set a replacement password, then return to sign in with your new credentials."
              : "Enter the owner email and we’ll send recovery instructions if the account exists."}
          </p>

          {!token ? (
            <form onSubmit={requestReset} noValidate className="mt-7 space-y-4">
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
              <button
                className="auth-interactive min-h-[52px] w-full rounded-[9px] bg-[#f35d3f] px-5 py-3 font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:cursor-not-allowed disabled:opacity-65"
                type="submit"
                disabled={requesting}
                aria-busy={requesting}
              >
                {requesting ? "Sending reset link…" : "Send reset link"}
              </button>
            </form>
          ) : (
            <form onSubmit={confirmReset} noValidate className="mt-7 space-y-4">
              <label className="block text-[12px] font-semibold text-[#655b53]">
                New password (12+ characters)
                <span className="relative mt-2 block">
                  <input
                    className="field !min-h-[54px] pr-16"
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={12}
                    autoComplete="new-password"
                    placeholder="At least 12 characters"
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
              <button
                className="auth-interactive min-h-[52px] w-full rounded-[9px] bg-[#f35d3f] px-5 py-3 font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:cursor-not-allowed disabled:opacity-65"
                type="submit"
                disabled={confirming}
                aria-busy={confirming}
              >
                {confirming ? "Updating password…" : "Set new password"}
              </button>
            </form>
          )}

          {message ? (
            <p className="animate-auth-status mt-5 rounded-xl border border-[#eee4db] bg-[#f7f1ea] px-4 py-3 text-sm text-[#655b53]" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="animate-auth-status mt-5 rounded-xl bg-[#fff1ee] px-4 py-3 text-sm text-[#9d2f1e]" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-7 border-t border-[#eee4db] pt-5 text-center">
            <Link
              href="/login"
              className="text-[11px] font-semibold text-[#e44e34] underline-offset-4 transition hover:text-[#c33e29] hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f35d3f] focus-visible:ring-offset-2"
            >
              Back to sign in
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}
