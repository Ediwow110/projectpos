"use client";

import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReportPageFrame } from "../../../components/ReportPageFrame";
import { DataTableFrame, MetricCard, Panel, SectionHeader } from "../../../components/premium";
import { ApiError, apiFetch } from "../../../lib/api";
import { money } from "../../../lib/reports";

interface BranchRow { branchId: string | null; name: string; type: string; sales: number; orders: number; margin: number | null; }
interface BranchesPayload { rows: BranchRow[]; compareLabel: string; }

export default function BranchesReportPage(): JSX.Element {
  const query = useQuery({ queryKey: ["report-branches"], queryFn: () => apiFetch<BranchesPayload>("/api/v1/reports/branches?compare=none"), retry: false });
  const rows = query.data?.rows ?? [];
  const sales = rows.reduce((sum, row) => sum + row.sales, 0);
  const orders = rows.reduce((sum, row) => sum + row.orders, 0);
  const marginRows = rows.filter((row) => row.margin !== null);
  const margin = marginRows.reduce((sum, row) => sum + (row.margin ?? 0), 0);
  return <ReportPageFrame title="Branch comparison" description="Compare branch sales and order context without inventing data for branches that have no report rows."><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Branches" value={rows.length} icon="⌘" meta="Visible report rows" /><MetricCard label="Sales" value={money(sales)} icon="₱" meta="Across visible branches" /><MetricCard label="Orders" value={orders} icon="▦" tone="info" meta="Across visible branches" /><MetricCard label="Margin" value={marginRows.length ? money(margin) : "—"} icon="↗" tone={marginRows.length ? "success" : "warning"} meta={marginRows.length ? "Cost-visible rows" : "Hidden by permissions"} /></section>{query.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading branch report…</Panel> : null}{query.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : "Could not load report."}</p></Panel> : null}{query.data ? <DataTableFrame><div className="px-5 py-4"><SectionHeader title="Branch report rows" /></div>{rows.length === 0 ? <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">No branch activity in this period.</p> : <table className="premium-table min-w-[720px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Branch</th><th className="px-5 pb-3">Type</th><th className="px-5 pb-3 text-right">Sales</th><th className="px-5 pb-3 text-right">Orders</th><th className="px-5 pb-3 text-right">Margin</th></tr></thead><tbody>{rows.map((row) => <tr key={row.branchId ?? "unscoped"}><td className="px-5 py-3 font-semibold text-[#2a241f]">{row.name}</td><td className="px-5 py-3 capitalize text-[#73685f]">{row.type}</td><td className="font-data px-5 py-3 text-right">{money(row.sales)}</td><td className="font-data px-5 py-3 text-right">{row.orders}</td><td className="font-data px-5 py-3 text-right">{row.margin === null ? "—" : money(row.margin)}</td></tr>)}</tbody></table>}</DataTableFrame> : null}</ReportPageFrame>;
}
