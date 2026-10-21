"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../../components/AppShell";
import { AtlasInventorySafeguards } from "../../../components/AtlasInventorySafeguards";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import type { ReplenishmentRow } from "../../../lib/inventory-counts";

interface Me { role: string; businessName?: string; activeBranchId: string | null; activeBranchName: string | null; permissions: string[]; }
interface RecommendationPage { items: ReplenishmentRow[]; }
interface Supplier { id: string; name: string; }

export default function ReplenishmentPage(): JSX.Element {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => apiFetch<{ items: Supplier[] }>("/api/v1/suppliers?status=active&pageSize=100"), enabled: me.data !== undefined, retry: false });
  const rows = useQuery({ queryKey: ["replenishment", me.data?.activeBranchId, supplierId], queryFn: () => apiFetch<RecommendationPage>(`/api/v1/inventory/replenishment${me.data?.activeBranchId ? `?branchId=${encodeURIComponent(me.data.activeBranchId)}` : ""}${supplierId ? `${me.data?.activeBranchId ? "&" : "?"}supplierId=${encodeURIComponent(supplierId)}` : ""}`), enabled: me.data !== undefined, retry: false });
  const role = me.data?.role ?? "cashier";
  const canCreate = me.data?.permissions.includes("purchase_order.write") ?? false;
  const selectedRows = (rows.data?.items ?? []).filter((row) => selected[row.productId] !== undefined);
  const selectedSupplier = selectedRows[0]?.supplierId ?? "";
  const sameSupplier = selectedRows.every((row) => row.supplierId && row.supplierId === selectedSupplier);

  async function createDraft(): Promise<void> {
    if (!sameSupplier || !selectedSupplier || selectedRows.length === 0) { setError("Select recommendations for one preferred supplier before creating a draft PO."); return; }
    setBusy(true); setError("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const result = await apiFetch<{ purchaseOrder: { id: string } }>("/api/v1/inventory/replenishment/draft-po", { csrfToken: csrf.csrfToken, init: { method: "POST", body: JSON.stringify({ branchId: me.data?.activeBranchId ?? null, supplierId: selectedSupplier, lines: selectedRows.map((row) => ({ productId: row.productId, quantity: selected[row.productId] ?? row.suggestedQty })) }), headers: { "Idempotency-Key": crypto.randomUUID() } } });
      router.push(`/purchase-orders/${result.purchaseOrder.id}`);
    } catch (err) { setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Draft purchase order failed."); } finally { setBusy(false); }
  }

  return <AppShell businessName={me.data?.businessName} role={role} atlasInventory><main className="mx-auto w-full max-w-none space-y-5 px-4 pb-10 pt-8 sm:px-7">
    <AtlasInventorySafeguards title="Reorder recommendations" description="Review purchase suggestions and reorder thresholds before creating supplier drafts." rules={["Recommendations never create automatic purchases.", "Draft purchase orders require purchasing permission.", "Supplier costs remain in authorized purchasing workflows."]}>
      <h3 className="font-display text-[22px] font-semibold text-[#202826]">Reorder recommendations</h3>
      <p className="mt-2 text-sm text-[var(--color-atlas-muted-strong)]">Outstanding inbound orders are considered when calculating suggested quantities.</p>
      {rows.isPending ? <p role="status" className="mt-4 text-sm">Loading recommendations…</p> : rows.isError ? <p role="alert" className="mt-4 text-sm text-[#a34132]">Recommendations could not be loaded.</p> : (rows.data?.items.length ?? 0) === 0 ? <p className="mt-4 rounded-lg bg-[#f0f3ef] p-4 text-sm">No replenishment is currently recommended.</p> : <div className="mt-4 space-y-2">{rows.data?.items.slice(0, 3).map((item) => <div key={item.productId} className="grid gap-2 rounded-lg bg-[#f7f8f5] p-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center"><strong className="text-[#202826]">{item.productName}</strong><span>{item.onHand} on hand</span><span>Threshold {item.reorderLevel}</span><span className="rounded-md bg-[#fcf1df] px-2 py-1 text-center text-[var(--color-atlas-warning-strong)]">Suggest {item.suggestedQty}</span></div>)}</div>}
      <a href="#replenishment-workflow" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#29332d] px-5 text-sm font-semibold text-white hover:bg-[#35423d]">Review recommendations</a>
    </AtlasInventorySafeguards>
    <div id="replenishment-workflow" className="scroll-mt-24" />
    <PageHeader eyebrow="Inventory / Replenishment" title="Replenishment" description={me.data?.activeBranchName ? `Advisory purchase recommendations for ${me.data.activeBranchName}. Inbound ordered quantities are included before a suggestion appears.` : "Review low and out-of-stock products using on hand plus outstanding ordered quantities. Nothing orders automatically."} actions={<Link href="/purchase-orders" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Purchase orders</Link>} />
    <section aria-label="Replenishment summary" className="grid gap-3 sm:grid-cols-3"><MetricCard label="Recommendations" value={rows.data?.items.length ?? 0} icon="↟" meta="Advisory only" /><MetricCard label="Supplier ready" value={(rows.data?.items ?? []).filter((row) => row.supplierId).length} icon="✓" tone="success" meta="Preferred mapping" /><MetricCard label="Supplier needed" value={(rows.data?.items ?? []).filter((row) => !row.supplierId).length} icon="!" tone="warning" meta="Needs review" /></section>
    <Panel className="p-5"><div className="flex flex-wrap items-end justify-between gap-3"><SectionHeader title="Recommendation queue" description="Formula: suggested quantity = max(0, reorder level × 2 − effective quantity)." /><label className="text-[11px] font-semibold text-[#655b53]">Preferred supplier<select value={supplierId} onChange={(event) => { setSupplierId(event.target.value); setSelected({}); }} className="field mt-1.5"><option value="">All suppliers</option>{(suppliers.data?.items ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label></div></Panel>
    {error ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p></Panel> : null}
    <DataTableFrame><table className="premium-table min-w-[1080px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Product</th><th className="px-5 pb-3 text-right">On hand</th><th className="px-5 pb-3 text-right">On order</th><th className="px-5 pb-3 text-right">Reorder / target</th><th className="px-5 pb-3 text-right">Suggested</th><th className="px-5 pb-3 text-right">Est. cost</th><th className="px-5 pb-3">Supplier</th><th className="px-5 pb-3 text-right">Select</th></tr></thead><tbody>{(rows.data?.items ?? []).map((row) => { const checked = selected[row.productId] !== undefined; return <tr key={row.productId}><td className="px-5 py-3"><p className="font-semibold">{row.productName}</p><p className="font-data text-[10px] text-[var(--color-atlas-muted-strong)]">{row.sku ?? row.productId}</p></td><td className="font-data px-5 py-3 text-right">{row.onHand}</td><td className="font-data px-5 py-3 text-right">{row.onOrderQty}</td><td className="font-data px-5 py-3 text-right">{row.reorderLevel} / {row.targetQty}</td><td className="font-data px-5 py-3 text-right font-semibold">{row.suggestedQty}</td><td className="font-data px-5 py-3 text-right">₱{((row.suggestedQty * row.unitCostMinor) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td><td className="px-5 py-3">{row.supplierName ? <><p className="font-semibold">{row.supplierName}</p><p className="text-[10px] text-[var(--color-atlas-muted-strong)]">{row.leadTimeDays === null ? "Lead time not set" : `${row.leadTimeDays} days`}</p></> : <StatusPill tone="warn">Supplier needed</StatusPill>}</td><td className="px-5 py-3 text-right">{row.supplierId ? <label className="inline-flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(event) => setSelected((current) => event.target.checked ? { ...current, [row.productId]: row.suggestedQty } : Object.fromEntries(Object.entries(current).filter(([id]) => id !== row.productId)))} /><span className="sr-only">Select {row.productName}</span>{checked ? <input aria-label={`Quantity for ${row.productName}`} type="number" min={1} max={row.suggestedQty} value={selected[row.productId]} onChange={(event) => setSelected((current) => ({ ...current, [row.productId]: Number(event.target.value) }))} className="field w-20 text-right font-data" /> : null}</label> : <span className="text-[11px] text-[var(--color-atlas-muted-strong)]">Review mapping</span>}</td></tr>; })}</tbody></table>{!rows.isPending && (rows.data?.items.length ?? 0) === 0 ? <p className="px-5 py-10 text-center text-sm text-[var(--color-atlas-verified)]">No products need replenishment at this branch.</p> : null}<div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eee6de] px-5 py-4"><p className="text-xs text-[#73685f]">{selectedRows.length} selected · inbound stock suppresses duplicate recommendations</p><div className="flex gap-2"><GhostButton type="button" onClick={() => void rows.refetch()}>Refresh</GhostButton>{canCreate ? <PrimaryButton type="button" disabled={busy || selectedRows.length === 0} onClick={() => void createDraft()}>Create draft PO</PrimaryButton> : null}</div></div></DataTableFrame>
  </main></AppShell>;
}
