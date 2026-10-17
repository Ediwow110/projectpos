"use client";

import React from "react";
import Link from "next/link";
import type { DashboardAttention } from "../lib/dashboard-view";

interface OwnerOverview {
  netRevenueMinor: number;
  orders: number;
}

/** A business-scoped overview; never presents Figma sample metrics as actual sales. */
export function AtlasOwnerOverview({
  overview, attention, loading, failed, onRetry,
}: {
  overview: OwnerOverview | null;
  attention: DashboardAttention[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
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
  return (
    <section aria-label="Atlas owner overview" data-ui="atlas-v4-owner-overview" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-data text-[11px] font-medium tracking-wide text-[#da614c]">OVERVIEW / OWNER</p>
          <h1 className="font-display mt-2 text-[29px] font-semibold text-[#202826]">Owner overview</h1>
          <p className="mt-2 text-[14px] text-[#71807a]">Revenue, transactions, and items that need your attention.</p>
        </div>
        <Link href="/reports/sales" className="inline-flex min-h-11 min-w-[190px] items-center justify-center rounded-lg bg-[#202826] px-5 text-[13px] font-semibold text-white hover:bg-[#36443c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
          Open sales reports
        </Link>
      </header>
      {loading ? <p role="status" className="text-[13px] text-[#71807a]">Loading authorized reports…</p> : null}
      {failed ? <div role="alert" className="rounded-lg border border-[#e9bcae] bg-[#fff0eb] px-4 py-3 text-[13px] text-[#963d32]">
        Owner overview unavailable. No sample figures are displayed.
        <button type="button" onClick={onRetry} className="ml-2 font-semibold underline">Retry</button>
      </div> : null}
      <div className="grid gap-4 sm:grid-cols-3" aria-label="Owner report metrics">
        {metrics.map((metric) => <div key={metric.label} className="min-h-[124px] rounded-xl border border-[#e5e9e3] bg-white px-5 py-5">
          <p className="font-display text-[26px] font-semibold text-[#202826]">{metric.value}</p>
          <p className="mt-2 text-[13px] text-[#71807a]">{metric.label}</p>
        </div>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_270px]">
        <section aria-label="Owner operational records" className="min-h-[360px] rounded-xl border border-[#e5e9e3] bg-white p-5">
          <h2 className="font-display text-[21px] font-semibold text-[#202826]">Operational records</h2>
          <p className="mt-5 border-b border-[#e5e9e3] pb-3 font-data text-[11px] tracking-wide text-[#71807a]">ITEM / REFERENCE · VALUE / STATUS</p>
          {hasReport && attention.length ? <ul className="mt-3 space-y-2">
            {attention.slice(0, 5).map((item) => <li key={item.kind}>
              <Link href={item.href} className="flex min-h-[57px] items-center justify-between gap-3 rounded-lg bg-[#f8faf7] px-4 py-3 text-[13px] text-[#202826] hover:bg-[#eff2ed] focus-visible:outline-2 focus-visible:outline-[#da614c]">
                <span className="min-w-0 truncate font-medium">{item.label}</span>
                <span className="shrink-0 font-data text-[11px] text-[#53615a]">{item.count} to review</span>
              </Link>
            </li>)}
          </ul> : hasReport ? <p className="mt-4 rounded-lg bg-[#eff2ed] p-4 text-[13px] text-[#53615a]">No reported attention items in the selected business scope.</p> : null}
          <Link href="/sales" className="mt-6 inline-flex rounded-lg py-2 text-[12px] font-semibold text-[#da614c] hover:underline">View sale records →</Link>
        </section>
        <aside aria-label="Owner workflow shortcuts" className="rounded-xl border border-[#e5e9e3] bg-white p-5">
          <h2 className="font-display text-[20px] font-semibold text-[#202826]">Workflow &amp; safeguards</h2>
          <ol className="mt-7 space-y-3">
            {actions.map((action, index) => <li key={action.href}>
              <Link href={action.href} className="flex min-h-[70px] items-center gap-3 rounded-lg bg-[#eff2ed] px-4 py-3 text-[12px] text-[#202826] hover:bg-[#e1eae1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
                <span className="font-data text-[#da614c]">{String(index + 1).padStart(2, "0")}</span>{action.label}
              </Link>
            </li>)}
          </ol>
        </aside>
      </div>
      <p className="text-[11px] text-[#71807a]">
        Report values reflect your authorized date and branch scope. Figma figures are illustrative only.
      </p>
    </section>
  );
}
