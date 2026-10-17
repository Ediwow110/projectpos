"use client";

import React from "react";
import Link from "next/link";
import { money } from "../lib/reports";
import type { DashboardAttention } from "../lib/dashboard-view";

interface ManagerOverview {
  orders: number;
  netRevenueMinor: number;
  compareLabel: string;
}

export function AtlasManagerControlCenter({
  overview,
  attention,
  loading,
  failed,
  onRetry,
}: {
  overview: ManagerOverview | null;
  attention: DashboardAttention[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const pending = loading || failed || !overview;
  const cards = [
    { label: "Orders in selected period", value: pending ? "—" : overview.orders.toLocaleString("en-PH") },
    { label: "Reported attention items", value: pending ? "—" : attention.reduce((total, item) => total + item.count, 0).toLocaleString("en-PH") },
    { label: "Net sales in selected period", value: pending ? "—" : `₱${money(overview.netRevenueMinor)}` },
  ];
  const actions = [
    { label: "Approval separation", href: "/customer-concerns" },
    { label: "Shift readiness", href: "/shifts" },
    { label: "Order queue", href: "/orders" },
  ];
  return (
    <section data-ui="atlas-manager-control-center" aria-label="Manager control center" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-data text-[11px] font-medium tracking-wide text-[#da614c]">OVERVIEW / MANAGER</p>
          <h1 className="font-display mt-2 text-[29px] font-semibold text-[#202826]">Manager control center</h1>
          <p className="mt-2 text-[14px] text-[#71807a]">Operational exceptions and manager decisions.</p>
        </div>
        <Link href="/exceptions" className="inline-flex min-h-11 min-w-[190px] items-center justify-center rounded-lg bg-[#202826] px-5 text-[13px] font-semibold text-white hover:bg-[#37453d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
          Review exceptions
        </Link>
      </header>
      {failed ? <p role="alert" className="rounded-lg border border-[#e9bcae] bg-[#fff0eb] px-4 py-3 text-[13px] text-[#963d32]">Manager overview data is unavailable. No sample metrics are displayed. <button type="button" onClick={onRetry} className="ml-2 font-semibold underline">Retry</button></p> : null}
      {loading ? <p role="status" className="text-[13px] text-[#71807a]">Loading authorized operations…</p> : null}
      <div className="grid gap-4 sm:grid-cols-3" aria-label="Manager overview metrics">
        {cards.map((card) => <div key={card.label} className="min-h-[124px] rounded-xl border border-[#e5e9e3] bg-white px-5 py-5">
          <p className="font-display text-[26px] font-semibold text-[#202826]">{card.value}</p>
          <p className="mt-2 text-[13px] text-[#71807a]">{card.label}</p>
        </div>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_270px]">
        <section aria-label="Operational records" className="min-h-[360px] rounded-xl border border-[#e5e9e3] bg-white p-5">
          <h2 className="font-display text-[21px] font-semibold text-[#202826]">Operational records</h2>
          <p className="mt-5 border-b border-[#e5e9e3] pb-3 font-data text-[11px] tracking-wide text-[#71807a]">ITEM / REFERENCE · VALUE / STATUS</p>
          {!pending && attention.length > 0 ? <ul className="mt-3 space-y-2">
            {attention.slice(0, 5).map((item) => <li key={item.kind}>
              <Link href={item.href} className="flex min-h-[57px] items-center justify-between gap-3 rounded-lg bg-[#f8faf7] px-4 py-3 text-[13px] text-[#202826] hover:bg-[#eff2ed] focus-visible:outline-2 focus-visible:outline-[#da614c]">
                <span className="min-w-0 truncate font-medium">{item.label}</span>
                <span className="shrink-0 font-data text-[11px] text-[#53615a]">{item.count} to review</span>
              </Link>
            </li>)}
          </ul> : !pending ? <p className="mt-4 rounded-lg bg-[#eff2ed] p-4 text-[13px] text-[#53615a]">No reported attention items within this authorized reporting scope.</p> : null}
          <Link href="/customer-concerns" className="mt-6 inline-flex rounded-lg py-2 text-[12px] font-semibold text-[#da614c] hover:underline">Open manager approvals →</Link>
        </section>
        <aside aria-label="Manager workflow safeguards" className="rounded-xl border border-[#e5e9e3] bg-white p-5">
          <h2 className="font-display text-[20px] font-semibold text-[#202826]">Workflow &amp; safeguards</h2>
          <ol className="mt-7 space-y-3">
            {actions.map((action, i) => <li key={action.href}>
              <Link href={action.href} className="flex min-h-[70px] items-center gap-3 rounded-lg bg-[#eff2ed] px-4 py-3 text-[12px] text-[#202826] hover:bg-[#e1eae1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
                <span className="font-data text-[#da614c]">{String(i + 1).padStart(2, "0")}</span>{action.label}
              </Link>
            </li>)}
          </ol>
        </aside>
      </div>
      <p className="text-[11px] text-[#71807a]">
        Metrics and operational records reflect authorized report results, not sample data or a platform-wide tenant directory.
      </p>
    </section>
  );
}
