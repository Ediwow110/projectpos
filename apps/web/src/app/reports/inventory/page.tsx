"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { ReportPageFrame } from "../../../components/ReportPageFrame";
import { DataTableFrame, MetricCard, Panel, SectionHeader } from "../../../components/premium";
import { StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";

interface InventoryPayload { healthy: number; low: number; out: number; untracked: number; lowStock: Array<{ productId: string; name: string; onHand: number; reorderLevel: number }>; movements: { received: number; sold: number; damaged: number; adjusted: number }; }

export default function InventoryReportPage(): JSX.Element {
  const query = useQuery({ queryKey: ["report-inventory"], queryFn: () => apiFetch<InventoryPayload>("/api/v1/reports/inventory"), retry: false });
  const data = query.data;
  return (
    <ReportPageFrame title="Inventory report" description="Review stock health and aggregate movement counts from the inventory ledger." actions={<Link href="/inventory" className="inline-flex min-h-10 items-center rounded-[10px] bg-[#f35d3f] px-4 text-sm font-semibold text-white hover:bg-[#d94a30]">Open inventory</Link>}>
      {data ? <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Healthy" value={data.healthy} icon="✓" tone="success" meta="Above reorder level" /><MetricCard label="Low" value={data.low} icon="!" tone="warning" meta="At/below reorder" /><MetricCard label="Out of stock" value={data.out} icon="×" tone="warning" meta="Zero on hand" /><MetricCard label="Untracked" value={data.untracked} icon="—" tone="info" meta="Inventory disabled" /></section><Panel className="p-5"><SectionHeader title="Movement totals" description="Aggregate movement counts returned by the report endpoint." /><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Received",data.movements.received],["Sold",data.movements.sold],["Damaged",data.movements.damaged],["Adjusted",data.movements.adjusted]].map(([label,value]) => <div key={String(label)} className="rounded-xl bg-[#f7f1ea] p-3"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--color-atlas-muted-strong)]">{label}</p><p className="font-data mt-1 text-lg font-semibold text-[#2a241f]">{value}</p></div>)}</div></Panel><DataTableFrame><div className="px-5 py-4"><SectionHeader title="Low and out of stock" description="Products requiring attention based on current on-hand and reorder levels." /></div>{data.lowStock.length === 0 ? <p className="px-5 pb-8 text-sm text-[var(--color-atlas-verified)]">Stock levels are healthy.</p> : <table className="premium-table min-w-[680px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Product</th><th className="px-5 pb-3 text-right">On hand</th><th className="px-5 pb-3 text-right">Reorder at</th><th className="px-5 pb-3 text-right">Status</th></tr></thead><tbody>{data.lowStock.map((product) => <tr key={product.productId}><td className="px-5 py-3"><Link href={`/inventory/${product.productId}`} className="font-semibold text-[#2a241f] hover:text-[var(--color-atlas-accent-strong)]">{product.name}</Link></td><td className="font-data px-5 py-3 text-right">{product.onHand}</td><td className="font-data px-5 py-3 text-right">{product.reorderLevel}</td><td className="px-5 py-3 text-right"><StatusPill tone={product.onHand <= 0 ? "bad" : "warn"}>{product.onHand <= 0 ? "Out" : "Low"}</StatusPill></td></tr>)}</tbody></table>}</DataTableFrame></> : null}
      {query.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading inventory report…</Panel> : null}{query.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : "Could not load report."}</p></Panel> : null}
    </ReportPageFrame>
  );
}
