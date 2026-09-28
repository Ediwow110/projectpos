"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { persistActiveSyncScope } from "../../lib/sync-store";

const SETUP_STEPS = [
  ["01", "Create the workspace", "Owner + business identity"],
  ["02", "Configure operations", "Tax, receipt and catalog setup"],
  ["03", "Start selling", "Registers, shifts and POS ready"],
] as const;

export default function RegisterPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await apiFetch<{
        user: { id: string };
        business: { id: string };
        verificationRequired?: boolean;
      }>("/api/v1/auth/register", {
        init: {
          method: "POST",
          body: JSON.stringify({ ownerName, email, password, businessName }),
        },
      });
      persistActiveSyncScope({ userId: result.user.id, businessId: result.business.id });
      queryClient.clear();
      if (result.verificationRequired) {
        window.sessionStorage.setItem("nexpos-verification-email", email);
        router.push("/verify-email");
        return;
      }
      router.push("/onboarding");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Registration failed");
    } finally {
      setSubmitting(false);
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

        <div className="animate-auth-copy relative z-10 mx-auto mt-16 max-w-[650px] lg:mt-28">
          <p className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[#ff8061]">
            New business workspace
          </p>
          <h1 className="font-display mt-5 text-[38px] font-bold leading-[1.12] tracking-[-0.035em] sm:text-[44px]">
            Build the workspace once.
            <span className="block">Run every shift from it.</span>
          </h1>
          <p className="mt-6 max-w-[600px] text-[15px] leading-6 text-[#a79e94] sm:text-[16px]">
            Create the owner account and business shell first. NexPOS will guide you through tax, receipts, products and team setup immediately after registration.
          </p>

          <div className="mt-10 overflow-hidden rounded-[14px] border border-[#3a332d] bg-[#1e1b18] shadow-[0_18px_42px_-14px_rgb(0_0_0/0.34)]">
            <div className="flex items-center justify-between gap-4 bg-[#28231f] px-5 py-4">
              <p className="font-data text-[10px] font-medium tracking-[0.12em]">SETUP FLOW</p>
              <span className="rounded-full bg-[#fff0ea] px-3 py-1.5 font-data text-[8px] font-medium text-[#e44e34]">3 STEPS</span>
            </div>
            <div className="divide-y divide-[#302b27] px-5">
              {SETUP_STEPS.map(([step, title, description]) => (
                <div key={step} className="grid grid-cols-[38px_minmax(0,1fr)] items-center gap-3 py-4">
                  <span className="font-data grid h-8 w-8 place-items-center rounded-[8px] bg-[#4a2118] text-[9px] font-semibold text-[#ff8061]">{step}</span>
                  <div>
                    <p className="text-[12px] font-semibold">{title}</p>
                    <p className="mt-1 text-[10px] text-[#a79e94]">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </section>

      <section className="relative grid min-h-[720px] place-items-center overflow-hidden p-5 sm:p-10 lg:min-h-screen">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[720px] w-[430px] -translate-x-1/2 -translate-y-1/2 rounded-[28px] bg-[#f7f1ea]" />

        <div className="animate-auth-card relative z-10 w-full max-w-[536px] rounded-[14px] border border-[#eee4db] bg-white p-6 shadow-[0_18px_48px_-14px_rgb(22_18_14/0.14)] sm:p-8">
          <p className="font-data text-[9px] font-medium uppercase tracking-[0.14em] text-[#e44e34]">Create secure workspace</p>
          <h2 className="font-display mt-5 text-[30px] font-bold text-[#17130f]">Create your business</h2>
          <p className="mt-2 text-sm leading-5 text-[#73685f]">Set up the owner account and your primary business identity.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-[12px] font-semibold text-[#655b53]">
                Your name
                <input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  required
                  autoComplete="name"
                  placeholder="Store owner"
                  className="field mt-2 !min-h-[54px]"
                />
              </label>
              <label className="block text-[12px] font-semibold text-[#655b53]">
                Business name
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                  autoComplete="organization"
                  placeholder="NexPOS Local Store"
                  className="field mt-2 !min-h-[54px]"
                />
              </label>
            </div>

            <label className="block text-[12px] font-semibold text-[#655b53]">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="owner@company.com"
                className="field mt-2 !min-h-[54px]"
              />
            </label>

            <label className="block text-[12px] font-semibold text-[#655b53]">
              Password (12+ characters)
              <span className="relative mt-2 block">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={12}
                  autoComplete="new-password"
                  placeholder="At least 12 characters"
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

            <div className="rounded-lg bg-[#fff0ea] px-4 py-3 text-[11px] leading-5 text-[#6f554b]">
              Your workspace is private by default. Business data appears only after authenticated access.
            </div>

            {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[13px] font-medium text-[#c43e3e]">{error}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className="auth-interactive min-h-[52px] w-full rounded-[9px] bg-[#f35d3f] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:cursor-not-allowed disabled:opacity-65"
            >
              {submitting ? "Creating workspace…" : "Create business"}
            </button>
          </form>

          <div className="mt-6 border-t border-[#eee4db] pt-5 text-center">
            <p className="text-[11px] text-[#73685f]">
              Already have a workspace?{" "}
              <Link href="/login" className="font-semibold text-[#e44e34] hover:text-[#c63d27]">Sign in</Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
