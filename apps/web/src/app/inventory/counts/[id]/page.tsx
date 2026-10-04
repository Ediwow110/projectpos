"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../../../components/AppShell";
import { ManagerApprovalDialog } from "../../../../components/ManagerApprovalDialog";
import { MetricCard, PageHeader, Panel, SectionHeader } from "../../../../components/premium";
import { DangerButton, PrimaryButton, StatusPill } from "../../../../components/ui";
import { ApiError, apiFetch } from "../../../../lib/api";
import { countTone, varianceSummary, type InventoryCount } from "../../../../lib/inventory-counts";

interface Me { role: string; businessName?: string; activeBranchName: string | null; }

async function mutate(path: string, body: unknown, key?: string): Promise<InventoryCount | { count: InventoryCount; replayed?: boolean; movements?: number }> {
  const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
  return apiFetch<InventoryCount | { count: InventoryCount; replayed?: boolean; movements?: number }>(path, { csrfToken: csrf.csrfToken, init: { method: "POST", body: JSON.stringify(body), headers: key ? { "Idempotency-Key": key } : undefined } });
}

export default function StockCountDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const query = useQuery({ queryKey: ["inventory-count", id], queryFn: () => apiFetch<InventoryCount>(`/api/v1/inventory/counts/${id}`), retry: false });
  const count = query.data;
  const role = me.data?.role ?? "cashier";
  const canPost = ["owner", "manager", "inventory"].includes(role);
  const canOperate = true;

  async function run(action: "start" | "submit" | "approve" | "cancel" | "post", approvalToken?: string): Promise<boolean> {
    if (!count || busy) return false;
    setBusy(true); setError("");
    try {
      const path = `/api/v1/inventory/counts/${id}/${action}`;
      const result = await mutate(path, { expectedVersion: count.version, ...(approvalToken ? { approvalToken } : {}) }, action === "post" ? crypto.randomUUID() : undefined);
      queryClient.setQueryData(["inventory-count", id], "count" in result ? result.count : result);
      return true;
    } catch (err) { setError(err instanceof ApiError ? `${err.code}: ${err.message}` : `Count ${action} failed.`); return false; } finally { setBusy(false); }
  }

  async function saveLine(lineId: string, countedQty: string): Promise<void> {
    if (!count || busy) return;
    setBusy(true); setError("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const result = await apiFetch<InventoryCount>(`/api/v1/inventory/counts/${id}/lines`, { csrfToken: csrf.csrfToken, init: { method: "PATCH", body: JSON.stringify({ expectedVersion: count.version, lines: [{ lineId, countedQty: countedQty === "" ? null : Number(countedQty) }] }) } });
      queryClient.setQueryData(["inventory-count", id], result);
    } catch (err) { setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Count line update failed."); } finally { setBusy(false); }
  }

  if (query.isPending || me.isPending) return <AppShell><main className="mx-auto max-w-[1240px] p-6"><Panel className="p-6 text-sm text-[#73685f]">Loading count…</Panel></main></AppShell>;
  if (query.isError || !count) return <AppShell><main className="mx-auto max-w-[1240px] p-6"><Panel className="border-[#efb9b9] bg-[#fff0f0] p-6"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : "Count could not be loaded."}</p><Link href="/inventory/counts" className="mt-3 inline-block text-sm font-semibold text-[#e44e34]">Back to stock counts</Link></Panel></main></AppShell>;
  const summary = varianceSummary(count.lines);
  const uncounted = count.lines.filter((line) => line.countedQty === null).length;
  return <AppShell businessName={me.data?.businessName} role={role}><main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
    <PageHeader eyebrow={`Inventory / ${count.countNumber}`} title={count.name} description={`${count.scopeType === "FULL" ? "Full" : "Partial"} count · ${me.data?.activeBranchName ?? "All branches"}`} actions={<><StatusPill tone={countTone(count.status)}>{count.status}</StatusPill><Link href="/inventory/counts" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">All counts</Link></>} />
    <section aria-label="Count summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Products" value={count.lines.length} icon="#" meta={`${uncounted} uncounted`} /><MetricCard label="Positive variance" value={`+${summary.positive}`} icon="↑" tone="success" meta="Units" /><MetricCard label="Negative variance" value={summary.negative} icon="↓" tone="warning" meta="Units" /><MetricCard label="Net variance" value={summary.net > 0 ? `+${summary.net}` : summary.net} icon="±" tone={summary.net === 0 ? "info" : "warning"} meta={`${summary.products} products changed`} /></section>
    {error ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p>{error.startsWith("COUNT_STALE") ? <p className="mt-1 text-xs text-[#8f3c3c]">Inventory changed after this count started. Refresh the affected products and recount them.</p> : null}</Panel> : null}
    <Panel className="p-5"><SectionHeader title="Count lines" description={count.status === "COUNTING" ? "Enter absolute counted quantities. Variance is calculated by the server." : "Expected and counted quantities are retained as an immutable operational record."} /><div className="mt-4 overflow-x-auto"><table className="premium-table min-w-[680px] text-left text-[12px]"><thead><tr><th className="pb-3">Product</th><th className="pb-3 text-right">Expected</th><th className="pb-3 text-right">Counted</th><th className="pb-3 text-right">Variance</th><th className="pb-3 text-right">Action</th></tr></thead><tbody>{count.lines.map((line) => <tr key={line.id}><td className="py-3"><p className="font-semibold">{line.productNameSnapshot}</p><p className="font-data text-[10px] text-[#8b8077]">{line.skuSnapshot ?? line.productId}</p></td><td className="font-data py-3 text-right">{line.expectedQtySnapshot}</td><td className="py-3 text-right">{count.status === "COUNTING" ? <input aria-label={`Counted quantity for ${line.productNameSnapshot}`} defaultValue={line.countedQty ?? ""} inputMode="numeric" min={0} type="number" className="field w-24 text-right font-data" onBlur={(event) => void saveLine(line.id, event.target.value)} /> : <span className="font-data">{line.countedQty ?? "—"}</span>}</td><td className={`font-data py-3 text-right font-semibold ${(line.varianceQty ?? 0) < 0 ? "text-[#c43e3e]" : (line.varianceQty ?? 0) > 0 ? "text-[#1f8a5b]" : "text-[#73685f]"}`}>{line.varianceQty === null ? "—" : line.varianceQty > 0 ? `+${line.varianceQty}` : line.varianceQty}</td><td className="py-3 text-right text-[11px] text-[#8b8077]">{line.countedQty === null ? "Needs count" : "Captured"}</td></tr>)}</tbody></table></div></Panel>
    {canOperate ? <Panel className="p-5"><SectionHeader title="Workflow" description="Each transition is online and version-checked. Posting adjusts inventory to counted quantities." /><div className="mt-4 flex flex-wrap gap-2">{count.status === "DRAFT" ? <PrimaryButton type="button" disabled={busy} onClick={() => void run("start")}>Start counting</PrimaryButton> : null}{count.status === "COUNTING" ? <PrimaryButton type="button" disabled={busy || uncounted > 0} onClick={() => void run("submit")}>Submit for review</PrimaryButton> : null}{count.status === "SUBMITTED" ? <PrimaryButton type="button" disabled={busy} onClick={() => canPost ? void run("approve") : setApprovalOpen(true)}>Approve count</PrimaryButton> : null}{count.status === "APPROVED" && canPost ? <PrimaryButton type="button" disabled={busy} onClick={() => void run("post")}>Post stock count</PrimaryButton> : null}{!["POSTED", "CANCELLED"].includes(count.status) ? <DangerButton type="button" disabled={busy} onClick={() => void run("cancel")}>Cancel count</DangerButton> : null}</div>{count.status === "COUNTING" && uncounted > 0 ? <p className="mt-3 text-xs font-medium text-[#8a5606]">Count all {uncounted} remaining product{uncounted === 1 ? "" : "s"} before submitting.</p> : null}{count.status === "APPROVED" ? <p className="mt-3 rounded-xl bg-[#fff4df] px-3 py-2 text-xs font-medium text-[#8a5606]">Posting will adjust inventory to the counted quantities. Zero-variance lines create no ledger rows.</p> : null}{count.status === "APPROVED" && !canPost ? <p className="mt-3 text-xs font-medium text-[#8a5606]">A manager-approved count is ready for an authorized inventory operator to post.</p> : null}</Panel> : null}
  </main><ManagerApprovalDialog open={approvalOpen} permission="inventory.adjust" action={{ kind: "inventory_count", countId: count.id }} title="Manager approval · approve stock count" description="An owner or manager authorizes this exact count snapshot before inventory can be corrected." summary={`${count.countNumber} · ${summary.products} variance product${summary.products === 1 ? "" : "s"}`} onApproved={(grant) => run("approve", grant.token)} onClose={() => setApprovalOpen(false)} /></AppShell>;
}
