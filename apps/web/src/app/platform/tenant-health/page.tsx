"use client";

import type { JSX, FormEvent } from "react";
import Link from "next/link";
import { useState } from "react";
import { NexposLogo } from "../../../components/brand/NexposLogo";
import { apiFetch, ApiError } from "../../../lib/api";

interface Diagnostics {
  businessId: string;
  businessName: string;
  consentExpiresAt: string;
  activeStaff: number;
  activeBranches: number;
  sales: number;
  openSupportCases: number;
}

/** Deliberately separate from a tenant's normal session and staff navigation. */
export default function PlatformTenantHealthPage(): JSX.Element {
  const [key, setKey] = useState("");
  const [consent, setConsent] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [data, setData] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function inspect(event: FormEvent): Promise<void> {
    event.preventDefault(); setBusy(true); setData(null); setError("");
    try {
      const result = await apiFetch<Diagnostics>(`/api/v1/platform/diagnostics/businesses/${encodeURIComponent(businessId.trim())}`, {
        init: { headers: { "x-platform-key": key, "x-owner-consent": consent } },
      });
      setData(result);
    } catch (cause) {
      setError(cause instanceof ApiError && (cause.status === 403 || cause.status === 404)
        ? "Operator credentials or active owner consent could not be verified."
        : "Tenant diagnostics unavailable. Check your connection.");
    } finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[#fcf8f3] px-4 py-8 sm:px-8">
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <NexposLogo size="md" />
        <span className="font-data text-xs font-semibold uppercase tracking-widest text-[#ad533f]">Restricted platform operator</span>
      </header>
      <section className="rounded-2xl border border-[#e6dcd3] bg-white p-6 shadow-sm sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-[#2a241f]">Tenant health</h1>
        <p className="mt-2 text-sm leading-6 text-[#73685f]">Read-only operational counts. Requires independent operator authentication and a time-limited consent issued by the business owner. No customer or payment details are shown.</p>
        <form className="mt-6 grid gap-4" onSubmit={(event) => void inspect(event)}>
          <label className="text-xs font-semibold text-[#655b53]">Business ID<input className="field mt-1.5" required value={businessId} onChange={(event) => setBusinessId(event.target.value)} autoComplete="off" /></label>
          <label className="text-xs font-semibold text-[#655b53]">Operator key<input className="field mt-1.5" required type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" /></label>
          <label className="text-xs font-semibold text-[#655b53]">Owner consent token<input className="field mt-1.5" required type="password" value={consent} onChange={(event) => setConsent(event.target.value)} autoComplete="off" /></label>
          <button type="submit" disabled={busy || !key || !consent || !businessId.trim()} className="min-h-11 rounded-lg bg-[#f35d3f] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking…" : "View authorized diagnostics"}</button>
        </form>
        {error && <p role="alert" className="mt-5 rounded-xl bg-[#fff0f0] p-4 text-sm text-[#a34132]">{error}</p>}
        {data && <section aria-label="Tenant diagnostics" className="mt-6 border-t border-[#eee4db] pt-5">
          <h2 className="font-display text-lg font-semibold">{data.businessName}</h2>
          <p className="mt-1 text-xs text-[#73685f]">Consent expires {new Date(data.consentExpiresAt).toLocaleString("en-PH")}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Active staff", data.activeStaff],
              ["Active branches", data.activeBranches],
              ["Sales records", data.sales],
              ["Open guest cases", data.openSupportCases],
            ].map(([label, value]) => <div key={label} className="rounded-xl bg-[#fcf8f3] p-3">
              <dt className="text-xs text-[#73685f]">{label}</dt><dd className="font-data mt-2 text-2xl font-bold">{value}</dd>
            </div>)}
          </dl>
          <p className="mt-4 text-xs text-[#73685f]">Read access is audited; this view does not permit changes to tenant resources.</p>
        </section>}
      </section>
      <Link href="/platform" className="inline-flex min-h-10 items-center text-xs font-semibold text-[#a64a34] underline">Other platform operations</Link>
    </div>
  </main>;
}
