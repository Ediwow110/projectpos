"use client";

import React from "react";
import Link from "next/link";
import type { DashboardAttention } from "../lib/dashboard-view";
import {
  readinessGapLabels,
  saleReadinessChecks,
  type SaleReadiness,
} from "../lib/sale-readiness";

interface OwnerOverview {
  netRevenueMinor: number;
  orders: number;
}

/** A business-scoped overview; never presents Figma sample metrics as actual sales. */
export function AtlasOwnerOverview({
  overview, attention, loading, failed, onRetry, period, periods, onPeriodChange,
  legacySetupReviewSteps = [],
  readiness = null, readinessFailed = false,
}: {
  overview: OwnerOverview | null;
  attention: DashboardAttention[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  period: number;
  periods: readonly { label: string; days: number }[];
  onPeriodChange: (days: number) => void;
  legacySetupReviewSteps?: string[];
  readiness?: SaleReadiness | null;
  readinessFailed?: boolean;
}) {
  const hasReport = !!overview && !loading && !failed;
  const attentionTotal = attention.reduce((total, item) => total + item.count, 0);
  const metrics = [
    { label: "Net sales in selected period", value: hasReport ? `₱${(overview.netRevenueMinor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—" },
    { label: "Sales in selected period", value: hasReport ? overview.orders.toLocaleString("en-PH") : "—" },
    { label: "Reported attention items", value: hasReport ? attentionTotal.toLocaleString("en-PH") : "—" },
  ];
  const actions = [
    { href: "/inventory", label: "Review stock" },
    { href: "/orders", label: "Open orders" },
    { href: "/shifts", label: "Review shifts" },
  ];
  const checks = readiness ? saleReadinessChecks(readiness) : [];
  const gaps = readiness ? readinessGapLabels(readiness) : [];
  return (
    <section aria-label="Atlas owner overview" data-ui="atlas-v4-owner-overview" className="space-y-6">
      {legacySetupReviewSteps.length > 0 ? (
        <aside aria-label="Review business setup" className="rounded-xl border border-[#f1c8a0] bg-[#fff9f0] px-5 py-4">
          <h2 className="text-[16px] font-semibold text-[#784724]">Review your business setup</h2>
          <p className="mt-2 text-[13px] leading-5 text-[#795b43]">
            Your earlier setup is marked complete, but {legacySetupReviewSteps.length} required configuration
            {legacySetupReviewSteps.length === 1 ? " step has" : " steps have"} not been saved.
            Review them before your first sale. Existing workspace access is preserved.
          </p>
          <Link href="/onboarding" className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-[#202826] px-4 text-[13px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
            Review missing setup steps
          </Link>
        </aside>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-data text-[11px] font-medium tracking-wide text-[var(--color-atlas-accent-strong)]">OVERVIEW / OWNER</p>
          <h1 className="font-display mt-2 text-[29px] font-semibold text-[#202826]">Owner overview</h1>
          <p className="mt-2 text-[14px] text-[var(--color-atlas-muted-strong)]">Revenue, transactions, and items that need your attention.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] font-medium text-[#53615a]">
            Report period
            <select aria-label="Owner report period" value={period}
              onChange={(event) => onPeriodChange(Number(event.target.value))}
              className="min-h-11 rounded-lg border border-[#dce3dc] bg-white px-3 text-[12px] font-semibold text-[#202826] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
              {periods.map((option) => <option key={option.days} value={option.days}>{option.label}</option>)}
            </select>
          </label>
          <Link href="/reports/sales" className="inline-flex min-h-11 min-w-[190px] items-center justify-center rounded-lg bg-[#202826] px-5 text-[13px] font-semibold text-white hover:bg-[#36443c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
            Open sales reports
          </Link>
        </div>
      </header>
      {loading ? <p role="status" className="text-[13px] text-[var(--color-atlas-muted-strong)]">Loading authorized reports…</p> : null}
      {failed ? <div role="alert" className="rounded-lg border border-[#e9bcae] bg-[#fff0eb] px-4 py-3 text-[13px] text-[#963d32]">
        Owner overview unavailable. No sample figures are displayed.
        <button type="button" onClick={onRetry} className="ml-2 font-semibold underline">Retry</button>
      </div> : null}
      <div className="grid gap-4 sm:grid-cols-3" aria-label="Owner report metrics">
        {metrics.map((metric) => <div key={metric.label} className="min-h-[124px] rounded-xl border border-[#e5e9e3] bg-white px-5 py-5">
          <p className="font-display text-[26px] font-semibold text-[#202826]">{metric.value}</p>
          <p className="mt-2 text-[13px] text-[var(--color-atlas-muted-strong)]">{metric.label}</p>
        </div>)}
      </div>
      <section aria-label="First sale readiness" className="rounded-xl border border-[#e5e9e3] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[19px] font-semibold text-[#202826]">First sale readiness</h2>
            <p className="mt-1 text-[12px] leading-5 text-[#53615a]">
              {readiness
                ? readiness.businessConfigured && readiness.legacySetupReviewSteps?.length === 0
                  ? "Business setup is complete. These operational checks come from the server."
                  : "Business setup is not complete yet. Finish setup before your first sale."
                : "Business setup and sale readiness are reported by the server."}
            </p>
          </div>
          {readiness ? (
            <span className={"shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold " +
              (readinessFailed
                ? "bg-[#fff4df] text-[#8a5a06]"
                : readiness.readyForFirstSale ? "bg-[#e8f4ec] text-[#267552]" : "bg-[#fff4df] text-[#8a5a06]")}>
              {readinessFailed ? "Readiness unavailable" : readiness.readyForFirstSale ? "Ready for first sale" : "Not ready for first sale"}
            </span>
          ) : null}
        </div>
        {readiness && readinessFailed ? (
          <p role="alert" className="mt-3 text-[11px] font-medium text-[#8a5a06]">
            Could not refresh sale readiness. Showing the last known server values; retry after refresh.
          </p>
        ) : null}
        {readiness ? (
          <>
            <ul className="mt-4 grid gap-2 sm:grid-cols-3">
              {checks.map((check) => (
                <li key={check.key} className="rounded-lg border border-[#e5e9e3] bg-[#fbfcfa] p-3">
                  <Link href={check.href}
                    className="inline-flex min-h-11 items-center text-[13px] font-medium text-[#202826] underline decoration-[#cdd6cd] underline-offset-2 hover:decoration-[#da614c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
                    {check.label}
                  </Link>
                  <p className={"mt-1 text-[11px] font-semibold " + (check.done ? "text-[#267552]" : "text-[#8a5a06]")}>
                    {check.done ? "Ready" : "To do · " + check.pending}
                  </p>
                </li>
              ))}
            </ul>
            {gaps.length > 0 ? (
              <ul className="mt-3 space-y-1 text-[12px] font-medium text-[#8a5a06]">
                {gaps.map((gap) => <li key={gap}>{gap}</li>)}
              </ul>
            ) : null}
          </>
        ) : (
          <p role={readinessFailed ? "alert" : "status"} className="mt-4 text-[12px] text-[#53615a]">
            {readinessFailed ? "Could not load sale readiness. Retry after refresh." : "Checking sale readiness…"}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e5e9e3] pt-4">
          <p className="text-[12px] text-[#53615a]">Saved business settings stay reviewable at any time.</p>
          <Link href="/onboarding"
            className="inline-flex min-h-11 items-center rounded-lg border border-[#dce3dc] bg-white px-4 text-[12px] font-semibold text-[#202826] hover:bg-[#f0f3ef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
            Review business setup
          </Link>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_270px]">
        <section aria-label="Owner operational records" className="min-h-[360px] rounded-xl border border-[#e5e9e3] bg-white p-5">
          <h2 className="font-display text-[21px] font-semibold text-[#202826]">Operational records</h2>
          <p className="mt-5 border-b border-[#e5e9e3] pb-3 font-data text-[11px] tracking-wide text-[var(--color-atlas-muted-strong)]">ITEM / REFERENCE · VALUE / STATUS</p>
          {hasReport && attention.length ? <ul className="mt-3 space-y-2">
            {attention.slice(0, 5).map((item) => <li key={item.kind}>
              <Link href={item.href} className="flex min-h-[57px] items-center justify-between gap-3 rounded-lg bg-[#f8faf7] px-4 py-3 text-[13px] text-[#202826] hover:bg-[#eff2ed] focus-visible:outline-2 focus-visible:outline-[#da614c]">
                <span className="min-w-0 truncate font-medium">{item.label}</span>
                <span className="shrink-0 font-data text-[11px] text-[#53615a]">{item.count} to review</span>
              </Link>
            </li>)}
          </ul> : hasReport ? <p className="mt-4 rounded-lg bg-[#eff2ed] p-4 text-[13px] text-[#53615a]">No reported attention items in the selected business scope.</p> : null}
          <Link href="/sales" className="mt-6 inline-flex rounded-lg py-2 text-[12px] font-semibold text-[var(--color-atlas-accent-strong)] hover:underline">View sale records →</Link>
        </section>
        <aside aria-label="Owner workflow shortcuts" className="rounded-xl border border-[#e5e9e3] bg-white p-5">
          <h2 className="font-display text-[20px] font-semibold text-[#202826]">Workflow &amp; safeguards</h2>
          <ol className="mt-7 space-y-3">
            {actions.map((action, index) => <li key={action.href}>
              <Link href={action.href} className="flex min-h-[70px] items-center gap-3 rounded-lg bg-[#eff2ed] px-4 py-3 text-[12px] text-[#202826] hover:bg-[#e1eae1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
                <span className="font-data text-[var(--color-atlas-accent-strong)]">{String(index + 1).padStart(2, "0")}</span>{action.label}
              </Link>
            </li>)}
          </ol>
        </aside>
      </div>
      <p className="text-[11px] text-[var(--color-atlas-muted-strong)]">
        Report values reflect the selected period and authorized branch scope. Figma figures are illustrative only.
      </p>
    </section>
  );
}
