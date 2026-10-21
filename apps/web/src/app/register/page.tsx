"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { clearActiveSyncScope, persistActiveSyncScope } from "../../lib/sync-store";
import { AtlasAuthBrandPanel } from "../../components/AtlasAuthBrandPanel";

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
    <main data-ui="atlas-v4-register" className="atlas-entry min-h-screen bg-[#f7f8f5] lg:grid lg:grid-cols-[535px_minmax(0,1fr)]">
      <AtlasAuthBrandPanel />
      <section className="relative min-w-0 px-5 py-10 sm:px-10 lg:min-h-screen lg:px-[82px] lg:pt-[128px]">

        <div className="animate-auth-card relative z-10 w-full max-w-[684px]">
          <p className="atlas-eyebrow">OWNER REGISTRATION</p>
          <h2 className="font-display mt-11 text-[30px] font-semibold text-[#202826] sm:text-[33px]">Create your business</h2>
          <p className="mt-3 text-[16px] leading-6 text-[var(--color-atlas-muted-strong)]">Set up a secure workspace in a few minutes.</p>

          <form noValidate onSubmit={submit} className="mt-12 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-[13px] font-medium text-[var(--color-atlas-muted-strong)]">
                Your name
                <input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  required
                  autoComplete="name"
                  placeholder="Owner name"
                  className="field mt-2 !min-h-[55px]"
                />
              </label>
              <label className="block text-[13px] font-medium text-[var(--color-atlas-muted-strong)]">
                Business name
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                  autoComplete="organization"
                  placeholder="NexPOS Local Store"
                  className="field mt-2 !min-h-[55px]"
                />
              </label>
            </div>

            <label className="block text-[13px] font-medium text-[var(--color-atlas-muted-strong)]">
              Business email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="owner@store.com"
                className="field mt-2 !min-h-[55px]"
              />
            </label>

            <label className="block text-[13px] font-medium text-[var(--color-atlas-muted-strong)]">
              Password (12+ characters)
              <span className="relative mt-2 block">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={12}
                  autoComplete="new-password"
                  placeholder="Enter a strong password"
                  className="field !min-h-[55px] pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[var(--color-atlas-accent-strong)]"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>

            {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[13px] font-medium text-[#c43e3e]">{error}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className="auth-interactive atlas-primary mt-5 w-full !bg-[#202826] px-4 text-[15px] disabled:cursor-not-allowed disabled:opacity-65"
            >
              {submitting ? "Creating workspace…" : "Create business"}
            </button>
          </form>

          <div className="mt-5">
            <p className="text-[14px] text-[var(--color-atlas-muted-strong)]">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-[var(--color-atlas-accent-strong)] underline-offset-4 hover:underline">Sign in</Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
