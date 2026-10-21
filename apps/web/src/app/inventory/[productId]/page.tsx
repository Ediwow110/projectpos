"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { Modal } from "../../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { canAdjustInventory } from "../../../lib/inventory";

interface MovementRow {
  id: string;
  type: string;
  qtyDelta: number;
  reason: string | null;
  actorId: string;
}

interface HistoryResult {
  items: MovementRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface ProductSummary {
  id: string;
  name: string;
  sku: string | null;
  trackInventory: boolean;
}

interface Me {
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

const MANUAL_TYPES = [
  ["opening_stock", "Opening stock"],
  ["receive", "Receive"],
  ["return", "Return"],
  ["damage", "Damage"],
  ["adjustment", "Adjustment"],
  ["stock_count", "Stock count correction"],
] as const;

function movementLabel(type: string): string {
  return MANUAL_TYPES.find(([value]) => value === type)?.[1] ?? type.replaceAll("_", " ");
}

function movementTone(delta: number): "ok" | "warn" | "info" {
  if (delta > 0) return "ok";
  if (delta < 0) return "warn";
  return "info";
}

export default function MovementHistoryPage({ params }: { params: Promise<{ productId: string }> }): JSX.Element {
  const { productId } = use(params);
  const [type, setType] = useState<(typeof MANUAL_TYPES)[number][0]>("receive");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [movementOpen, setMovementOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const productQuery = useQuery({
    queryKey: ["product", productId],
    queryFn: () => apiFetch<ProductSummary>(`/api/v1/products/${productId}`),
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ["movements", productId],
    queryFn: () => apiFetch<HistoryResult>(`/api/v1/inventory/products/${productId}/movements`),
    retry: false,
  });

  const role = meQuery.data?.role ?? "cashier";
  const adjustable = canAdjustInventory(role);
  const data = historyQuery.data;
  const visibleNet = useMemo(() => (data?.items ?? []).reduce((sum, movement) => sum + movement.qtyDelta, 0), [data?.items]);
  const visiblePositive = (data?.items ?? []).filter((movement) => movement.qtyDelta > 0).length;
  const visibleNegative = (data?.items ?? []).filter((movement) => movement.qtyDelta < 0).length;

  function signedDelta(): number | null {
    const parsed = Number(qty);
    if (!Number.isInteger(parsed) || parsed === 0) return null;
    if (["opening_stock", "receive", "return"].includes(type)) return Math.abs(parsed);
    if (type === "damage") return -Math.abs(parsed);
    return parsed;
  }

  async function recordMovement(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setSuccess("");
    const delta = signedDelta();
    if (delta === null) {
      setError("VALIDATION: Quantity must be a non-zero whole number.");
      return;
    }
    if ((type === "damage" || type === "adjustment") && reason.trim().length < 3) {
      setError("VALIDATION: Damage and adjustment movements require a reason.");
      return;
    }
    setBusy(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/inventory/movements", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            productId,
            type,
            qtyDelta: delta,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }),
        },
      });
      setQty("");
      setReason("");
      setMovementOpen(false);
      setSuccess(`${movementLabel(type)} movement recorded.`);
      await historyQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Record failed");
    } finally {
      setBusy(false);
    }
  }

  if (historyQuery.isError || productQuery.isError) {
    return (
      <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
        <main className="mx-auto max-w-[1240px] p-6"><Panel className="border-[#efb9b9] bg-[#fff0f0] p-6"><p role="alert" className="text-sm font-medium text-[#c43e3e]">Movement history could not be loaded.</p><Link href="/inventory" className="mt-3 inline-block text-sm font-semibold text-[var(--color-atlas-accent-strong)]">← Back to inventory</Link></Panel></main>
      </AppShell>
    );
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Inventory / Movement ledger"
          title={productQuery.data?.name ?? "Movement history"}
          description="Every stock change is recorded as an auditable movement. Sales and transfers are system-generated and are not offered as manual movement types here."
          actions={
            <>
              <Link href="/inventory" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Inventory</Link>
              {adjustable ? <PrimaryButton type="button" onClick={() => { setError(""); setSuccess(""); setMovementOpen(true); }}>+ Record movement</PrimaryButton> : null}
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Movement summary">
          <MetricCard label="Movements" value={data?.total ?? 0} icon="▦" meta="All recorded movements" />
          <MetricCard label="Visible net delta" value={visibleNet > 0 ? `+${visibleNet}` : visibleNet} icon="↕" tone={visibleNet < 0 ? "warning" : "success"} meta="Current page only" />
          <MetricCard label="Positive entries" value={visiblePositive} icon="+" tone="success" meta="Current page" />
          <MetricCard label="Negative entries" value={visibleNegative} icon="−" tone={visibleNegative > 0 ? "warning" : "success"} meta="Current page" />
        </section>

        {success ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[var(--color-atlas-verified)]">{success}</div> : null}
        {error ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p></Panel> : null}

        <DataTableFrame>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <SectionHeader title="Movement ledger" description="Newest entries first. Reference-generated movements remain visible even though they cannot be manually created here." />
            {productQuery.data?.sku ? <span className="font-data rounded-full bg-[#f7f1ea] px-3 py-1.5 text-[10px] text-[#73685f]">SKU {productQuery.data.sku}</span> : null}
          </div>
          {historyQuery.isLoading ? <p className="px-5 pb-6 text-sm text-[#73685f]">Loading movements…</p> : null}
          {data && data.items.length === 0 ? <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">No movements recorded yet.</p> : null}
          {data && data.items.length > 0 ? (
            <table className="premium-table min-w-[720px] text-left text-[12px]">
              <thead><tr><th className="px-5 pb-3">Type</th><th className="px-5 pb-3">Reason</th><th className="px-5 pb-3">Actor</th><th className="px-5 pb-3 text-right">Quantity delta</th><th className="px-5 pb-3 text-right">Direction</th></tr></thead>
              <tbody>
                {data.items.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-5 py-3 font-semibold capitalize text-[#2a241f]">{movementLabel(movement.type)}</td>
                    <td className="px-5 py-3 text-[#73685f]">{movement.reason ?? "—"}</td>
                    <td className="font-data px-5 py-3 text-[var(--color-atlas-muted-strong)]">{movement.actorId.slice(0, 8)}</td>
                    <td className="font-data px-5 py-3 text-right font-semibold">{movement.qtyDelta > 0 ? `+${movement.qtyDelta}` : movement.qtyDelta}</td>
                    <td className="px-5 py-3 text-right"><StatusPill tone={movementTone(movement.qtyDelta)}>{movement.qtyDelta > 0 ? "Inbound" : movement.qtyDelta < 0 ? "Outbound" : "Neutral"}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </DataTableFrame>
        {!adjustable ? <Panel className="bg-[#fff4df] p-4 text-[11px] font-medium text-[#8a5606]">Your role can review inventory history but cannot record manual stock adjustments.</Panel> : null}
      </main>

      <Modal
        open={movementOpen && adjustable}
        onClose={() => !busy && setMovementOpen(false)}
        title="Record inventory movement"
        description="Use manual movements only for real stock events that are not already generated by sales or transfer workflows."
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setMovementOpen(false)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="movement-form" disabled={busy || !qty.trim()}>{busy ? "Recording…" : "Record movement"}</PrimaryButton></div>}
      >
        <form id="movement-form" noValidate onSubmit={(event) => void recordMovement(event)} className="space-y-4">
          <label className="block text-[11px] font-semibold text-[#655b53]">Movement type<select value={type} onChange={(event) => setType(event.target.value as (typeof MANUAL_TYPES)[number][0])} className="field mt-1.5">{MANUAL_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block text-[11px] font-semibold text-[#655b53]">Quantity {type === "adjustment" || type === "stock_count" ? "delta (signed)" : ""}<input autoFocus value={qty} onChange={(event) => setQty(event.target.value)} inputMode="numeric" placeholder={type === "adjustment" || type === "stock_count" ? "10 or -2" : "10"} className="field mt-1.5" /></label>
          <label className="block text-[11px] font-semibold text-[#655b53]">Reason {type === "damage" || type === "adjustment" ? "(required)" : "(optional)"}<input value={reason} onChange={(event) => setReason(event.target.value)} className="field mt-1.5" placeholder="Delivery, recount, damaged stock…" /></label>
          <div className="rounded-xl bg-[#f7f1ea] p-3 text-[11px] leading-5 text-[#73685f]">Receive/opening/return are recorded as positive deltas. Damage is recorded as a negative delta automatically. Adjustment and stock-count corrections preserve the sign you enter.</div>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>
    </AppShell>
  );
}
