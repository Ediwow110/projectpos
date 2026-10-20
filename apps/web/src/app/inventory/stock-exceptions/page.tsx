"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../../components/AppShell";
import { AtlasInventorySafeguards } from "../../../components/AtlasInventorySafeguards";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { PageHeader, MetricCard, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";

interface Me {
  role: string;
  businessName?: string;
  activeBranchId: string | null;
  activeBranchName?: string | null;
  permissions: string[];
}
interface StockRisk {
  id: string; businessId: string; branchId: string | null; productId: string;
  kind: "DAMAGE" | "EXPIRY"; quantity: number; expiresOn: string | null;
  reason: string; status: "OPEN" | "DISPOSED";
  createdAt: string; reportedBy: string; disposedAt: string | null;
  movementId: string | null;
}
interface Product { productId: string; productName: string; qtyOnHand: number; branchId: string | null }

const dateText = (day: string) => new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-PH", {
  timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric",
});

function riskLabel(row: StockRisk, today: string): string {
  if (row.status === "DISPOSED") return "Disposed";
  if (row.kind === "DAMAGE") return "Damage reported";
  if (row.expiresOn && row.expiresOn < today) return "Expired";
  if (row.expiresOn === today) return "Expires today";
  return "Expiry date recorded";
}

export default function StockRiskPage(): JSX.Element {
  const client = useQueryClient();
  const [productId, setProductId] = useState("");
  const [kind, setKind] = useState<"DAMAGE" | "EXPIRY">("DAMAGE");
  const [quantity, setQuantity] = useState("1");
  const [expiresOn, setExpiresOn] = useState("");
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState<"ALL" | "OPEN" | "DISPOSED">("OPEN");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const reportKey = useRef<string | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const scope = me.data?.activeBranchId ?? null;
  const risks = useQuery({
    queryKey: ["stock-exceptions", scope, me.data?.role],
    queryFn: () => apiFetch<{ items: StockRisk[] }>("/api/v1/inventory/stock-exceptions"),
    enabled: me.data !== undefined,
    retry: false,
  });
  const balances = useQuery({
    queryKey: ["stock-exception-products", scope],
    queryFn: () => apiFetch<{ items: Product[] }>(`/api/v1/inventory/balances?page=1&pageSize=100${scope ? `&branchId=${encodeURIComponent(scope)}` : ""}`),
    enabled: me.data !== undefined,
    retry: false,
  });
  const role = me.data?.role ?? "cashier";
  const canManage = me.data?.permissions.includes("inventory.adjust") ?? false;
  const all = risks.data?.items ?? [];
  const visible = all.filter((row) => filter === "ALL" || row.status === filter);
  const today = new Date().toISOString().slice(0, 10);
  const selected = all.find((row) => row.id === confirmId);
  const productNames = new Map((balances.data?.items ?? []).map((product) => [product.productId, product.productName]));

  function changed(): void {
    reportKey.current = null;
    setSuccess("");
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !canManage) return;
    setError(""); setSuccess(""); setBusy(true);
    try {
      if (!productId || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1) {
        throw new Error("Choose an inventory product and a positive whole-unit quantity.");
      }
      if (kind === "EXPIRY" && !expiresOn) throw new Error("Choose an expiration date.");
      if (reason.trim().length < 3) throw new Error("Describe the stock issue in at least three characters.");
      reportKey.current ??= crypto.randomUUID();
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/inventory/stock-exceptions", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          headers: { "Idempotency-Key": reportKey.current },
          body: JSON.stringify({
            productId, branchId: scope, kind, quantity: Number(quantity),
            expiresOn: kind === "EXPIRY" ? expiresOn : null, reason: reason.trim(),
          }),
        },
      });
      reportKey.current = null;
      setProductId(""); setQuantity("1"); setReason(""); setExpiresOn("");
      setSuccess("Stock issue recorded. On-hand inventory was not changed.");
      await client.invalidateQueries({ queryKey: ["stock-exceptions"] });
    } catch (cause) {
      setError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` :
        cause instanceof Error ? cause.message : "Stock issue could not be recorded. You can retry.");
    } finally { setBusy(false); }
  }

  async function dispose(): Promise<void> {
    if (!selected || busy || !canManage) return;
    setError(""); setSuccess(""); setBusy(true);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/inventory/stock-exceptions/${encodeURIComponent(selected.id)}/dispose`, {
        csrfToken: csrf.csrfToken, init: { method: "POST" },
      });
      setConfirmId(null);
      setSuccess(`Disposed ${selected.quantity} unit(s). One audited damage movement was recorded.`);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["stock-exceptions"] }),
        client.invalidateQueries({ queryKey: ["stock-exception-products"] }),
        client.invalidateQueries({ queryKey: ["inventory-balances"] }),
      ]);
    } catch (cause) {
      setError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : "Disposal failed. No stock movement was confirmed.");
    } finally { setBusy(false); }
  }

  return <AppShell role={role} businessName={me.data?.businessName} atlasInventory><main className="mx-auto w-full max-w-none space-y-5 px-4 pb-10 pt-8 sm:px-7">
    <AtlasInventorySafeguards title="Expiry & damage" description="Record damaged or date-sensitive products without changing inventory automatically." alert="Lot-level tracking and automatic quarantine require a separate data-model review." rules={["Reports capture the affected product, quantity, reason and any expiry date.", "Open reports do not automatically quarantine or reserve products.", "Only an authorized disposal can reduce the recorded stock balance."]}>
      <h3 className="font-display text-[22px] font-semibold text-[#202826]">Reported stock risks</h3>
      <p className="mt-2 text-sm text-[#748078]">Report an observation below, then review the details and any subsequent disposal.</p>
      {risks.isPending ? <p role="status" className="mt-4 text-sm">Loading reports…</p> : risks.isError ? <p role="alert" className="mt-4 text-sm text-[#a34132]">Stock reports are not available.</p> : all.length === 0 ? <p className="mt-4 rounded-lg bg-[#f0f3ef] p-4 text-sm">No reports within your current scope.</p> : <div className="mt-4 space-y-2">{all.slice(0, 3).map((risk) => <div key={risk.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#f7f8f5] p-4 text-sm"><span className="font-semibold text-[#202826]">{productNames.get(risk.productId) ?? "Inventory product"} · {risk.quantity} units</span><span className="text-[#748078]">{risk.kind === "DAMAGE" ? "Damaged" : "Expiry observation"}</span><StatusPill tone={risk.status === "DISPOSED" ? "ok" : "warn"}>{riskLabel(risk, today)}</StatusPill></div>)}</div>}
      <a href="#stock-risk-workflow" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#29332d] px-5 text-sm font-semibold text-white hover:bg-[#35423d]">Review stock issues</a>
    </AtlasInventorySafeguards>
    <div id="stock-risk-workflow" className="scroll-mt-24" />
    <PageHeader eyebrow="Inventory / Atlas 2026" title="Damage & expiration register"
      description="Record damaged and date-sensitive inventory. Recording an issue does not remove units from saleable stock; disposal is a separate, audited step."
      actions={<Link href="/inventory/counts" className="inline-flex min-h-10 items-center rounded-lg border border-[#e4d9d0] px-3 py-2 text-sm font-semibold">Stock counts</Link>} />
    <section aria-label="Stock risk summary" className="grid gap-3 sm:grid-cols-3">
      <MetricCard label="Open reports" value={all.filter((row) => row.status === "OPEN").length} icon="!" tone="warning" meta="Observed, not yet disposed" />
      <MetricCard label="Expiry reports" value={all.filter((row) => row.kind === "EXPIRY" && row.status === "OPEN").length} icon="◷" meta="Check dated stock" />
      <MetricCard label="Disposed reports" value={all.filter((row) => row.status === "DISPOSED").length} icon="✓" tone="success" meta="Audit trail retained" />
    </section>
    {error && <Panel className="border-[#e9b5aa] bg-[#fff2ee] p-4"><p role="alert" className="text-sm text-[#ad4635]">{error}</p></Panel>}
    {success && <Panel className="border-[#c1ddc5] bg-[#f4f9f4] p-4"><p role="status" className="text-sm text-[#28613e]">{success}</p></Panel>}
    {canManage ? <Panel className="p-5"><SectionHeader title="Report a stock issue" description={me.data?.activeBranchName ? `Scope: ${me.data.activeBranchName}` : "Scope: head office inventory (select a branch in the workspace header for a specific location)"} />
      <form className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => void submit(event)}>
        <label className="text-xs font-semibold">Inventory product<select className="field mt-1.5" required value={productId} onChange={(event) => { setProductId(event.target.value); changed(); }}>
          <option value="">Select a product</option>{(balances.data?.items ?? []).map((row) => <option key={row.productId} value={row.productId}>{row.productName} · {row.qtyOnHand} on hand</option>)}
        </select></label>
        <label className="text-xs font-semibold">Issue type<select className="field mt-1.5" value={kind} onChange={(event) => { setKind(event.target.value as "DAMAGE" | "EXPIRY"); changed(); }}>
          <option value="DAMAGE">Damaged inventory</option><option value="EXPIRY">Expiration date</option>
        </select></label>
        <label className="text-xs font-semibold">Affected units<input className="field mt-1.5" type="number" min={1} step={1} max={1000000} inputMode="numeric" required value={quantity} onChange={(event) => { setQuantity(event.target.value); changed(); }} /></label>
        {kind === "EXPIRY" && <label className="text-xs font-semibold">Expiration date<input className="field mt-1.5" required type="date" value={expiresOn} onChange={(event) => { setExpiresOn(event.target.value); changed(); }} /></label>}
        <label className="text-xs font-semibold sm:col-span-2">Issue description<input className="field mt-1.5" required maxLength={300} value={reason} onChange={(event) => { setReason(event.target.value); changed(); }} placeholder="Describe the damage, batch or expiry observation" /></label>
        <div className="flex items-end"><PrimaryButton type="submit" disabled={busy || balances.isPending}>{busy ? "Saving…" : "Record issue"}</PrimaryButton></div>
      </form>
      <p className="mt-4 rounded-lg bg-[#fff5e5] px-3 py-2 text-xs leading-5 text-[#87622a]">Open reports do not quarantine, reserve, or deduct inventory automatically. Physically separate unsafe goods; record disposal after authorized review.</p>
    </Panel> : <Panel className="p-4 text-sm text-[#87622a]">You do not have inventory-adjust permission. Creating and disposing of stock reports is restricted.</Panel>}
    <Panel className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader title="Issue history" description="Reported observations and completed disposals remain visible for audit." />
        <label className="text-xs font-semibold">Status<select aria-label="Filter stock risks" className="field mt-1.5" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="OPEN">Open</option><option value="DISPOSED">Disposed</option><option value="ALL">All reports</option></select></label>
      </div>
      {risks.isPending ? <p role="status" className="py-6 text-sm text-[#73685f]">Loading stock issues…</p> : null}
      {risks.isError ? <p role="alert" className="py-4 text-sm text-[#a34132]">Could not load stock issues. Check your access and retry.</p> : null}
      {!risks.isPending && !risks.isError && visible.length === 0 && <p className="rounded-lg bg-[#fafbf9] p-5 text-sm text-[#6a746d]">No stock issues match this filter.</p>}
      <div className="grid gap-3 md:grid-cols-2">{visible.map((risk) => <article key={risk.id} className="rounded-xl border border-[#e8e6de] bg-[#fafbf9] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-[#202826]">{productNames.get(risk.productId) ?? `Product ${risk.productId.slice(0, 8)}`}</h3><StatusPill tone={risk.status === "DISPOSED" ? "ok" : "warn"}>{riskLabel(risk, today)}</StatusPill></div>
        <p className="mt-2 text-sm text-[#526058]">{risk.reason}</p>
        <p className="mt-2 text-xs text-[#707b75]">{risk.kind === "DAMAGE" ? "Damaged" : "Dated"} · {risk.quantity} unit(s) · Reported {new Date(risk.createdAt).toLocaleDateString("en-PH")}{risk.expiresOn ? ` · Expires ${dateText(risk.expiresOn)}` : ""}</p>
        {risk.status === "DISPOSED" ? <p className="mt-2 break-all text-xs text-[#267552]">Disposed · movement {risk.movementId}</p> :
          canManage ? <div className="mt-3 flex justify-end"><GhostButton type="button" onClick={() => setConfirmId(risk.id)}>Record disposal</GhostButton></div> : null}
      </article>)}</div>
      <div className="flex justify-end"><GhostButton type="button" onClick={() => void risks.refetch()} disabled={risks.isFetching}>Refresh</GhostButton></div>
    </Panel>
    <ConfirmDialog open={selected !== undefined} title="Dispose of reported stock?"
      description="This operation creates an irreversible negative stock movement and updates the selected branch balance."
      confirmLabel={`Dispose ${selected?.quantity ?? 0} unit(s)`} busy={busy}
      details={selected ? `${productNames.get(selected.productId) ?? selected.productId} · ${selected.reason} · ${selected.quantity} units` : undefined}
      onCancel={() => { if (!busy) setConfirmId(null); }} onConfirm={() => void dispose()} />
  </main></AppShell>;
}
