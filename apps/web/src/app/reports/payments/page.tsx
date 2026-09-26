"use client";

import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReportPageFrame } from "../../../components/ReportPageFrame";
import { DataTableFrame, MetricCard, Panel, SectionHeader } from "../../../components/premium";
import { StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { BarChart } from "../../../lib/charts";
import { money } from "../../../lib/reports";

interface PaymentsPayload { byMethod: Array<{ method: string; total: number; count: number }>; unknown: number; refunded: number; }
const label = (value: string): string => value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());

export default function PaymentsReportPage(): JSX.Element {
  const query = useQuery({ queryKey: ["report-payments"], queryFn: () => apiFetch<PaymentsPayload>("/api/v1/reports/payments?compare=none"), retry: false });
  const data = query.data;
  const total = data?.byMethod.reduce((sum, row) => sum + row.total, 0) ?? 0;
  const count = data?.byMethod.reduce((sum, row) => sum + row.count, 0) ?? 0;
  return <ReportPageFrame title="Payments report" description="Review tender mix, recorded refunds and payments that still require reconciliation.">{data ? <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Payment total" value={money(total)} icon="₱" meta="Across methods" /><MetricCard label="Payments" value={count} icon="▦" tone="info" meta="Recorded count" /><MetricCard label="Unknown" value={data.unknown} icon="!" tone={data.unknown ? "warning" : "success"} meta="Needs reconciliation" /><MetricCard label="Refunded" value={money(data.refunded)} icon="↩" tone="info" meta="Recorded refunds" /></section><Panel className="p-5"><SectionHeader title="Tender mix" description="Chart values use recorded payment totals by method." /><div className="mt-4"><BarChart bars={data.byMethod.map((row) => ({ label: label(row.method), value: row.total }))} /></div></Panel><DataTableFrame><div className="px-5 py-4"><SectionHeader title="Payment methods" /></div>{data.byMethod.length === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No payment data available.</p> : <table className="premium-table min-w-[620px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Method</th><th className="px-5 pb-3 text-right">Total</th><th className="px-5 pb-3 text-right">Count</th><th className="px-5 pb-3 text-right">State</th></tr></thead><tbody>{data.byMethod.map((row) => <tr key={row.method}><td className="px-5 py-3 font-semibold text-[#2a241f]">{label(row.method)}</td><td className="font-data px-5 py-3 text-right">{money(row.total)}</td><td className="font-data px-5 py-3 text-right">{row.count}</td><td className="px-5 py-3 text-right"><StatusPill tone="ok">Recorded</StatusPill></td></tr>)}</tbody></table>}</DataTableFrame></> : null}{query.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading payments report…</Panel> : null}{query.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : "Could not load report."}</p></Panel> : null}</ReportPageFrame>;
}
