"use client";

import type { JSX, FormEvent } from "react";
import Link from "next/link";
import { useState } from "react";
import { AtlasPlatformShell } from "../../../components/AtlasPlatformShell";
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

  return <AtlasPlatformShell current="health" title="Platform tenant health" description="Platform administrators are not retail owners and must never inherit unscoped customer data.">
    <section aria-label="Platform access boundaries" className="grid gap-4 sm:grid-cols-3">
      {[
        ["TENANT ACCESS", data ? "Verified" : "Restricted", "Per-business consent only"],
        ["DIAGNOSTICS", data ? "Available" : "Awaiting consent", "No cross-tenant browsing"],
        ["OPERATOR SCOPE", "Read-only", "Aggregate counters only"],
      ].map(([label, value, caption]) => <div key={label} className="rounded-xl border border-[#e5e9e3] bg-white px-5 py-4">
        <p className="font-data text-[11px] font-semibold tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">{label}</p>
        <p className="mt-3 font-display text-[22px] font-semibold text-[#202826]">{value}</p>
        <p className="mt-2 text-xs text-[var(--color-atlas-muted-strong)]">{caption}</p>
      </div>)}
    </section>
    <div className="max-w-5xl">
      <section className="rounded-[13px] border border-[#e5e9e3] bg-white p-5 sm:p-7">
        <h2 className="font-display text-[23px] font-semibold text-[#202826]">Tenant health</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--color-atlas-muted-strong)]">Inspect one authorized tenant. Independent operator credentials and unexpired owner consent are required; no customer or payment details are returned.</p>
        <form className="mt-6 grid gap-4" onSubmit={(event) => void inspect(event)}>
          <label className="text-xs font-semibold text-[#655b53]">Business ID<input className="field mt-1.5" required value={businessId} onChange={(event) => setBusinessId(event.target.value)} autoComplete="off" /></label>
          <label className="text-xs font-semibold text-[#655b53]">Operator key<input className="field mt-1.5" required type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" /></label>
          <label className="text-xs font-semibold text-[#655b53]">Owner consent token<input className="field mt-1.5" required type="password" value={consent} onChange={(event) => setConsent(event.target.value)} autoComplete="off" /></label>
          <button type="submit" disabled={busy || !key || !consent || !businessId.trim()} className="min-h-11 rounded-lg bg-[#29332d] px-5 text-sm font-semibold text-white hover:bg-[#35423d] disabled:opacity-50">{busy ? "Checking…" : "View authorized diagnostics"}</button>
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
            ].map(([label, value]) => <div key={label} className="rounded-xl bg-[#f7f8f5] p-3">
              <dt className="text-xs text-[#73685f]">{label}</dt><dd className="font-data mt-2 text-2xl font-bold">{value}</dd>
            </div>)}
          </dl>
          <p className="mt-4 text-xs text-[#73685f]">Read access is audited; this view does not permit changes to tenant resources.</p>
        </section>}
      </section>
      <div className="mt-4 flex flex-wrap gap-5 text-xs">
        <Link href="/platform/support-access" className="font-semibold text-[#267552] underline">How to obtain owner consent</Link>
        <Link href="/platform" className="font-semibold text-[#53615a] underline">Other platform operations</Link>
      </div>
    </div>
  </AtlasPlatformShell>;
}
