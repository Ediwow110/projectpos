"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { clearActiveSyncScope, persistActiveSyncScope } from "../../lib/sync-store";
import { AtlasEntryBrand } from "../../components/AtlasEntryBrand";

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
    if (!ownerName.trim() || !businessName.trim() || !email.trim()) {
      setError("VALIDATION: Name, business name, and email are required.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("VALIDATION: Enter a valid email address.");
      return;
    }
    if (password.length < 12) {
      setError("VALIDATION: Password must be at least 12 characters.");
      return;
    }
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
      queryClient.clear();
      if (result.verificationRequired) {
        clearActiveSyncScope();
        window.sessionStorage.setItem("nexpos-verification-email", email);
        router.push("/verify-email");
        return;
      }
      persistActiveSyncScope({ userId: result.user.id, businessId: result.business.id });
      router.push("/onboarding");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main data-ui="atlas-v4-register" className="atlas-entry min-h-screen lg:grid lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1fr)]">
      <section className="relative overflow-hidden border-b border-[#e5e9e3] bg-white px-6 py-7 text-[#202826] sm:px-10 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-14 lg:py-10">

        <div className="relative z-10">
          <AtlasEntryBrand />
        </div>

        <div className="animate-auth-copy relative z-10 mx-auto mt-12 max-w-[650px] lg:mt-24">
          <p className="atlas-eyebrow">
            New business workspace
          </p>
          <h1 className="font-display mt-5 text-[38px] font-semibold leading-[1.12] tracking-[-0.035em] sm:text-[44px]">
            Build the workspace once.
            <span className="block">Run every shift from it.</span>
          </h1>
          <p className="mt-6 max-w-[600px] text-[15px] leading-7 text-[#748078] sm:text-[16px]">
            Create the owner account and business shell first. NexPOS will guide you through tax, receipts, products and team setup immediately after registration.
          </p>

          <div className="mt-9 overflow-hidden rounded-xl border border-[#e5e9e3] bg-[#fbfcfa]">
            <div className="flex items-center justify-between gap-4 bg-white px-5 py-4">
              <p className="font-data text-[10px] font-medium tracking-[0.12em]">SETUP FLOW</p>
              <span className="rounded-md bg-[#e8f4ec] px-3 py-1.5 font-data text-[10px] font-semibold text-[#267552]">3 STEPS</span>
            </div>
            <div className="divide-y divide-[#e5e9e3] px-5">
              {SETUP_STEPS.map(([step, title, description]) => (
                <div key={step} className="grid grid-cols-[38px_minmax(0,1fr)] items-center gap-3 py-4">
                  <span className="font-data grid h-8 w-8 place-items-center rounded-[8px] bg-[#fff0eb] text-[11px] font-semibold text-[#da614c]">{step}</span>
                  <div>
                    <p className="text-[12px] font-semibold">{title}</p>
                    <p className="mt-1 text-[11px] text-[#748078]">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </section>

      <section className="relative grid min-h-[620px] place-items-center p-5 sm:p-10 lg:min-h-screen">

        <div className="animate-auth-card atlas-panel relative z-10 w-full max-w-[536px] p-6 sm:p-9">
          <p className="atlas-eyebrow">CREATE SECURE WORKSPACE</p>
          <h2 className="font-display mt-5 text-[30px] font-semibold text-[#202826]">Create your business</h2>
          <p className="mt-2 text-sm leading-5 text-[#73685f]">Set up the owner account and your primary business identity.</p>

          <form noValidate onSubmit={submit} className="mt-6 space-y-4">
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

            <div className="rounded-lg border border-[#e5e9e3] bg-[#fbfcfa] px-4 py-3 text-[12px] leading-5 text-[#748078]">
              Your workspace is private by default. Business data appears only after authenticated access.
            </div>

            {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[13px] font-medium text-[#c43e3e]">{error}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className="auth-interactive atlas-primary w-full px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-65"
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
