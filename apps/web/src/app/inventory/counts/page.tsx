"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../../components/AppShell";
import { DataTableFrame, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { countTone, type InventoryCount } from "../../../lib/inventory-counts";

interface Me { role: string; businessName?: string; activeBranchId: string | null; activeBranchName: string | null; }
interface CountPage { items: InventoryCount[]; total: number; page: number; pageSize: number; }
interface BalancePage { items: Array<{ productId: string; productName: string; qtyOnHand: number }>; }

function csrfAnd(method: string, body: unknown, key?: string) {
  return apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf").then((csrf) => apiFetch("/api/v1/inventory/counts", { csrfToken: csrf.csrfToken, init: { method, body: JSON.stringify(body), headers: key ? { "Idempotency-Key": key } : undefined } }));
}

export default function StockCountsPage(): JSX.Element {
  const [status, setStatus] = useState("all");
  const [name, setName] = useState("");
  const [scopeType, setScopeType] = useState<"FULL" | "PARTIAL">("FULL");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const query = useQuery({ queryKey: ["inventory-counts", status, me.data?.activeBranchId], queryFn: () => apiFetch<CountPage>(`/api/v1/inventory/counts?status=${status}${me.data?.activeBranchId ? `&branchId=${encodeURIComponent(me.data.activeBranchId)}` : ""}`), enabled: me.data !== undefined, retry: false });
  const balances = useQuery({ queryKey: ["count-products", me.data?.activeBranchId], queryFn: () => apiFetch<BalancePage>(`/api/v1/inventory/balances?page=1&pageSize=100${me.data?.activeBranchId ? `&branchId=${encodeURIComponent(me.data.activeBranchId)}` : ""}`), enabled: me.data !== undefined && scopeType === "PARTIAL", retry: false });
  const role = me.data?.role ?? "cashier";
  const canCreate = ["owner", "manager", "inventory"].includes(role);

  async function createCount(event: React.FormEvent): Promise<void> {
    event.preventDefault(); setError("");
    if (!name.trim()) { setError("Give this count a name before creating it."); return; }
    try {
      if (scopeType === "PARTIAL" && selectedProductIds.length === 0) { setError("Select at least one product for a partial count."); return; }
      await csrfAnd("POST", { name: name.trim(), scopeType, branchId: me.data?.activeBranchId ?? null, ...(scopeType === "FULL" ? {} : { productIds: selectedProductIds }) }, crypto.randomUUID());
      setName(""); await query.refetch();
    } catch (err) { setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Count creation failed."); }
  }

  return <AppShell businessName={me.data?.businessName} role={role}><main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
    <PageHeader eyebrow="Inventory / Stock counts" title="Stock counts" description={me.data?.activeBranchName ? `Physical counts for ${me.data.activeBranchName}. Expected quantities are frozen when counting starts.` : "Create full or partial physical counts with server-verified snapshots before any stock correction."} actions={<Link href="/inventory" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Inventory balances</Link>} />
    {canCreate ? <Panel className="p-5"><SectionHeader title="Start a count" description="Full counts include every active tracked product. Use a partial count for a cycle count." /><form onSubmit={(event) => void createCount(event)} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]"><label className="text-[11px] font-semibold text-[#655b53]">Count name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Morning floor count" className="field mt-1.5" /></label><label className="text-[11px] font-semibold text-[#655b53]">Scope<select value={scopeType} onChange={(event) => { const next = event.target.value as "FULL" | "PARTIAL"; setScopeType(next); if (next === "FULL") setSelectedProductIds([]); }} className="field mt-1.5"><option value="FULL">Full count</option><option value="PARTIAL">Partial count</option></select></label><PrimaryButton type="submit" className="self-end">Create count</PrimaryButton></form>{scopeType === "PARTIAL" ? <fieldset className="mt-4 rounded-xl border border-[#eee4db] bg-[#fcf8f3] p-3"><legend className="px-1 text-[11px] font-semibold text-[#655b53]">Products to count</legend><div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">{(balances.data?.items ?? []).map((product) => <label key={product.productId} className="flex items-center gap-2 text-xs text-[#4d443d]"><input type="checkbox" checked={selectedProductIds.includes(product.productId)} onChange={(event) => setSelectedProductIds((current) => event.target.checked ? [...current, product.productId] : current.filter((id) => id !== product.productId))} />{product.productName}</label>)}</div></fieldset> : null}{error ? <p role="alert" className="mt-3 rounded-xl bg-[#fff0f0] px-3 py-2 text-sm font-medium text-[#c43e3e]">{error}</p> : null}</Panel> : <Panel className="bg-[#fff4df] p-4 text-sm font-medium text-[#8a5606]">Your role can review count history. Count creation and posting are restricted to inventory operators.</Panel>}
    <Panel className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><SectionHeader title="Count history" description="Posted counts are immutable. Stale counts never change inventory." /><label className="text-[11px] font-semibold text-[#655b53]">Status<select value={status} onChange={(event) => setStatus(event.target.value)} className="field mt-1.5"><option value="all">All statuses</option>{["DRAFT", "COUNTING", "SUBMITTED", "APPROVED", "POSTED", "CANCELLED"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div></Panel>
    {query.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : "Could not load stock counts."}</p></Panel> : null}
    <DataTableFrame><table className="premium-table min-w-[860px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Count</th><th className="px-5 pb-3">Branch</th><th className="px-5 pb-3">Scope</th><th className="px-5 pb-3">Created</th><th className="px-5 pb-3 text-right">Variance units</th><th className="px-5 pb-3 text-right">Status</th></tr></thead><tbody>{(query.data?.items ?? []).map((count) => { const variance = count.lines.reduce((sum, line) => sum + (line.varianceQty ?? 0), 0); return <tr key={count.id}><td className="px-5 py-3"><Link href={`/inventory/counts/${count.id}`} className="font-semibold text-[#2a241f] hover:text-[#d94a30]">{count.countNumber}<span className="mt-0.5 block text-[11px] font-normal text-[#73685f]">{count.name}</span></Link></td><td className="font-data px-5 py-3 text-[#73685f]">{count.branchId ?? "All branches"}</td><td className="px-5 py-3 text-[#73685f]">{count.scopeType === "FULL" ? "Full" : "Partial"} · {count.lines.length} products</td><td className="px-5 py-3 text-[#73685f]">{new Date(count.createdAt).toLocaleDateString("en-PH")}</td><td className="font-data px-5 py-3 text-right">{variance > 0 ? `+${variance}` : variance}</td><td className="px-5 py-3 text-right"><StatusPill tone={countTone(count.status)}>{count.status}</StatusPill></td></tr>; })}</tbody></table>{!query.isPending && (query.data?.items.length ?? 0) === 0 ? <p className="px-5 py-10 text-center text-sm text-[#8b8077]">No stock counts match this filter.</p> : null}<div className="flex justify-end border-t border-[#eee6de] px-5 py-4"><GhostButton type="button" onClick={() => void query.refetch()}>Refresh</GhostButton></div></DataTableFrame>
  </main></AppShell>;
}
