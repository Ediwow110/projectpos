"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "../../lib/api";
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

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    try {
      const deviceId = window.localStorage.getItem("pos-device-id");
      const result = await apiFetch<{ userId: string; businessId: string }>("/api/v1/auth/login", {
        init: {
          method: "POST",
          body: JSON.stringify({ email, password, ...(deviceId ? { deviceId } : {}) }),
        },
      });
      persistActiveSyncScope({ userId: result.userId, businessId: result.businessId });
      queryClient.clear();
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Login failed");
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f3] lg:grid lg:grid-cols-[1.08fr_.92fr]">
      <section className="relative overflow-hidden bg-[#161411] px-6 py-8 text-white sm:px-10 lg:min-h-screen lg:px-14 lg:py-12">
        <span aria-hidden className="absolute inset-y-0 left-0 w-2.5 bg-[#f35d3f]" />

        <div className="relative z-10 flex items-center gap-4">
          <div className="font-display grid h-11 w-11 place-items-center rounded-[9px] bg-[#f35d3f] text-lg font-bold">N</div>
          <div>
            <p className="font-display text-[22px] font-bold leading-none">NEXPOS</p>
            <p className="font-data mt-2 text-[9px] font-medium tracking-[0.14em] text-[#a79e94]">RETAIL OPERATIONS</p>
          </div>
        </div>

        <div className="relative z-10 mx-auto mt-16 max-w-[650px] lg:mt-28">
          <p className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[#ff8061]">
            Private by default · Ready for every shift
          </p>
          <h1 className="font-display mt-5 text-[38px] font-bold leading-[1.12] tracking-[-0.035em] sm:text-[44px]">
            Run the business.
            <span className="block">Keep the business private.</span>
          </h1>
          <p className="mt-6 max-w-[600px] text-[15px] leading-6 text-[#a79e94] sm:text-[16px]">
            Your operational data stays behind secure sign-in. The landing experience shows the product — never your sales, cash, customer, or inventory figures.
          </p>

          <div className="mt-10 grid gap-3 rounded-xl border border-[#3a332d] bg-[#1e1b18] p-4 sm:grid-cols-3">
            {FEATURES.map(([title, description], index) => (
              <div key={title} className="min-w-0 p-1">
                <p className="font-data text-[9px] font-medium tracking-[0.08em] text-[#ff8061]">0{index + 1}</p>
                <p className="mt-3 text-[12px] font-semibold">{title}</p>
                <p className="mt-2 text-[10px] leading-4 text-[#a79e94]">{description}</p>
              </div>
            ))}
          </div>

          <section className="mt-8 overflow-hidden rounded-[14px] border border-[#3a332d] bg-[#1e1b18] shadow-[0_18px_42px_-14px_rgb(0_0_0/0.34)]">
            <div className="flex items-center justify-between gap-4 bg-[#28231f] px-5 py-4">
              <p className="font-data text-[10px] font-medium tracking-[0.12em]">PROTECTED WORKSPACE</p>
              <span className="rounded-full bg-[#eaf7f0] px-3 py-1.5 font-data text-[8px] font-medium text-[#1f8a5b]">● SECURE</span>
            </div>
            <div className="divide-y divide-[#302b27] px-5">
              {PRIVACY_ROWS.map(([label, description, state], index) => (
                <div key={label} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 py-4">
                  <span aria-hidden className={"grid h-7 w-7 place-items-center rounded-[7px] font-data text-[10px] " + (index === 0 ? "bg-[#4a2118] text-[#ff8061]" : "bg-[#28231f] text-[#a79e94]")}>
                    {index === 0 ? "◆" : index === 1 ? "◇" : "•"}
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold">{label}</p>
                    <p className="mt-1 text-[10px] text-[#a79e94]">{description}</p>
                  </div>
                  <span className="font-data text-[9px] font-medium text-[#ff8061]">{state}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="relative z-10 mt-8 flex flex-wrap gap-2 lg:mt-7">
          {["Encrypted session", "Role-based access", "Device visibility"].map((label) => (
            <span key={label} className="rounded-full bg-[#28231f] px-4 py-2 text-[10px] font-medium text-[#a79e94]">{label}</span>
          ))}
        </div>
      </section>

      <section className="relative grid min-h-[720px] place-items-center overflow-hidden p-5 sm:p-10 lg:min-h-screen">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[720px] w-[430px] -translate-x-1/2 -translate-y-1/2 rounded-[28px] bg-[#f7f1ea]" />

        <div className="relative z-10 w-full max-w-[536px] rounded-[14px] border border-[#eee4db] bg-white p-6 shadow-[0_18px_48px_-14px_rgb(22_18_14/0.14)] sm:p-8">
          <p className="font-data text-[9px] font-medium uppercase tracking-[0.14em] text-[#e44e34]">Secure business access</p>
          <h2 className="font-display mt-5 text-[30px] font-bold text-[#17130f]">Welcome back</h2>
          <p className="mt-2 text-sm text-[#73685f]">Sign in to open your secure workspace.</p>

          <div className="mt-6 flex items-center gap-3 rounded-lg bg-[#fff0ea] p-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f35d3f] font-data text-xs text-white">◆</div>
            <div>
              <p className="text-[12px] font-semibold text-[#2a241f]">Private workspace</p>
              <p className="mt-1 text-[10px] text-[#73685f]">Your business data appears only after authentication</p>
            </div>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
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
              className="min-h-[52px] w-full rounded-[9px] bg-[#f35d3f] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] transition hover:bg-[#d94a30]"
            >
              Sign in securely
            </button>
            <p className="font-data text-[9px] text-[#9a8d83]">Press Enter to continue</p>
          </form>

          <div className="mt-6 border-t border-[#eee4db] pt-5">
            <div className="rounded-lg bg-[#f7f1ea] p-4">
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
