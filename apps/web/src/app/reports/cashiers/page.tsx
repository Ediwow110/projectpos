"use client";

import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReportPageFrame } from "../../../components/ReportPageFrame";
import { DataTableFrame, MetricCard, Panel, SectionHeader } from "../../../components/premium";
import { ApiError, apiFetch } from "../../../lib/api";
import { money } from "../../../lib/reports";

interface CashiersPayload { actors: Array<{ actorId: string; name: string; sales: number; orders: number; refunds: number; refundTotal: number; discounts: number; varianceContext: { shiftsClosed: number; totalVariance: number } }>; }

export default function CashiersReportPage(): JSX.Element {
  const query = useQuery({ queryKey: ["report-cashiers"], queryFn: () => apiFetch<CashiersPayload>("/api/v1/reports/cashiers?compare=none"), retry: false });
  const actors = query.data?.actors ?? [];
  const sales = actors.reduce((sum, actor) => sum + actor.sales, 0);
  const orders = actors.reduce((sum, actor) => sum + actor.orders, 0);
  const refunds = actors.reduce((sum, actor) => sum + actor.refundTotal, 0);
  return <ReportPageFrame title="Cashiers report" description="Operational context per staff member for review and audit. It is not presented as a ranking or performance score."><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Staff with activity" value={actors.length} icon="○" meta="Report actors" /><MetricCard label="Sales" value={money(sales)} icon="₱" meta="Across visible staff" /><MetricCard label="Orders" value={orders} icon="▦" tone="info" meta="Across visible staff" /><MetricCard label="Refund total" value={money(refunds)} icon="↩" tone="warning" meta="Across visible staff" /></section>{query.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading staff report…</Panel> : null}{query.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : "Could not load report."}</p></Panel> : null}{query.data ? <DataTableFrame><div className="px-5 py-4"><SectionHeader title="Staff activity context" description="Sales, orders, refunds, discounts, closed shifts and variance are displayed side-by-side without an overall score." /></div>{actors.length === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No staff activity in range.</p> : <table className="premium-table min-w-[980px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Staff</th><th className="px-5 pb-3 text-right">Sales</th><th className="px-5 pb-3 text-right">Orders</th><th className="px-5 pb-3 text-right">Refunds</th><th className="px-5 pb-3 text-right">Refund total</th><th className="px-5 pb-3 text-right">Discounts</th><th className="px-5 pb-3 text-right">Shifts closed</th><th className="px-5 pb-3 text-right">Cash variance</th></tr></thead><tbody>{actors.map((actor) => <tr key={actor.actorId}><td className="px-5 py-3 font-semibold text-[#2a241f]">{actor.name}</td><td className="font-data px-5 py-3 text-right">{money(actor.sales)}</td><td className="font-data px-5 py-3 text-right">{actor.orders}</td><td className="font-data px-5 py-3 text-right">{actor.refunds}</td><td className="font-data px-5 py-3 text-right">{money(actor.refundTotal)}</td><td className="font-data px-5 py-3 text-right">{money(actor.discounts)}</td><td className="font-data px-5 py-3 text-right">{actor.varianceContext.shiftsClosed}</td><td className="font-data px-5 py-3 text-right">{money(actor.varianceContext.totalVariance)}</td></tr>)}</tbody></table>}</DataTableFrame> : null}</ReportPageFrame>;
}
