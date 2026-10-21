"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ReportPageFrame } from "../../../components/ReportPageFrame";
import { DataTableFrame, MetricCard, Panel, SectionHeader } from "../../../components/premium";
import { ApiError, apiFetch } from "../../../lib/api";
import { BarChart } from "../../../lib/charts";
import { money } from "../../../lib/reports";

interface ProductRow { productId: string; name: string; qty: number; revenue: number; profit: number | null; marginPct: number | null; }

export default function ProductsReportPage(): JSX.Element {
  const [tab, setTab] = useState("top");
  const query = useQuery({ queryKey: ["report-products", tab], queryFn: () => apiFetch<{ rows: ProductRow[] }>(`/api/v1/reports/products?compare=none&tab=${tab}&limit=20`), retry: false });
  const rows = query.data?.rows ?? [];
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const qty = rows.reduce((sum, row) => sum + row.qty, 0);
  const profitRows = rows.filter((row) => row.profit !== null);
  const profit = profitRows.reduce((sum, row) => sum + (row.profit ?? 0), 0);

  return (
    <ReportPageFrame title="Products report" description="Review product sales, slow movers and long-inactive catalog items without fabricating category contribution.">
      <Panel className="p-5"><SectionHeader title="View" description="Switch between the report tabs supported by the products report endpoint." /><label className="mt-4 block max-w-xs text-[11px] font-semibold text-[#655b53]">Report view<select value={tab} onChange={(event) => setTab(event.target.value)} className="field mt-1.5"><option value="top">Top sellers</option><option value="slow">Slow · no sales in range</option><option value="dead">Dead · no sales in 90 days</option></select></label></Panel>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Rows" value={rows.length} icon="▦" meta="Visible report rows" /><MetricCard label="Units" value={qty} icon="◇" tone="info" meta="Across visible rows" /><MetricCard label="Revenue" value={money(revenue)} icon="₱" meta="Across visible rows" /><MetricCard label="Profit" value={profitRows.length ? money(profit) : "—"} icon="↗" tone={profitRows.length ? "success" : "warning"} meta={profitRows.length ? "Cost-visible rows" : "Hidden by permissions"} /></section>
      {query.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : "Could not load report."}</p></Panel> : null}
      {query.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading product report…</Panel> : null}
      {query.data ? <><Panel className="p-5"><SectionHeader title="Revenue by product" description="Chart values use the authoritative report rows." /><div className="mt-4"><BarChart bars={rows.map((row) => ({ label: row.name, value: row.revenue }))} /></div></Panel><DataTableFrame><div className="px-5 py-4"><SectionHeader title="Product rows" description="Profit and margin remain blank when cost visibility is not granted." /></div>{rows.length === 0 ? <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">No products in this report view.</p> : <table className="premium-table min-w-[760px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Product</th><th className="px-5 pb-3 text-right">Qty</th><th className="px-5 pb-3 text-right">Revenue</th><th className="px-5 pb-3 text-right">Profit</th><th className="px-5 pb-3 text-right">Margin</th></tr></thead><tbody>{rows.map((row) => <tr key={row.productId}><td className="px-5 py-3 font-semibold text-[#2a241f]">{row.name}</td><td className="font-data px-5 py-3 text-right">{row.qty}</td><td className="font-data px-5 py-3 text-right">{money(row.revenue)}</td><td className="font-data px-5 py-3 text-right">{row.profit === null ? "—" : money(row.profit)}</td><td className="font-data px-5 py-3 text-right">{row.marginPct === null ? "—" : `${row.marginPct}%`}</td></tr>)}</tbody></table>}</DataTableFrame></> : null}
    </ReportPageFrame>
  );
}
