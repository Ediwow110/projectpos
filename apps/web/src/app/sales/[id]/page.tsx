"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Modal } from "../../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { DangerButton, GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";

interface Me {
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

interface SaleLine {
  id: string;
  name: string;
  qty: number;
  priceMinor: number;
  lineTotalMinor: number;
}

interface SalePayment {
  id: string;
  method: string;
  amountMinor: number;
  status: string;
}

interface RefundRow {
  id: string;
  status: string;
  totalMinor: number;
  reason: string | null;
  requestedBy: string;
  approvedBy: string;
  items: Array<{ saleItemId: string; qty: number; amountMinor: number }>;
}

interface SaleDetail {
  id: string;
  receiptNo: string;
  status: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  registerId: string | null;
  customer: { id: string; name: string } | null;
  customerName: string | null;
  items: SaleLine[];
  payments: SalePayment[];
  refunds: RefundRow[];
}

type ReconcileOutcome = "SUCCEEDED" | "FAILED";
type RefundMode = "request" | "approve" | "reject";

function money(minor: number): string {
  return (minor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusTone(status: string): "ok" | "warn" | "bad" | "info" {
  if (["COMPLETED", "SUCCEEDED", "REFUNDED"].includes(status)) return "ok";
  if (["PAYMENT_UNKNOWN", "REFUND_REQUESTED", "PARTIALLY_REFUNDED"].includes(status)) return "warn";
  if (["FAILED", "VOIDED", "CANCELLED", "REJECTED"].includes(status)) return "bad";
  return "info";
}

function methodLabel(method: string): string {
  return method.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function SaleDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconcileOutcome, setReconcileOutcome] = useState<ReconcileOutcome | null>(null);
  const [refundMode, setRefundMode] = useState<RefundMode | null>(null);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const detailQuery = useQuery({ queryKey: ["sale", id], queryFn: () => apiFetch<SaleDetail>(`/api/v1/sales/${id}`), retry: false });

  const role = meQuery.data?.role ?? "cashier";
  const canRefund = role === "owner" || role === "manager" || role === "inventory";
  const canReconcile = role === "owner" || role === "manager";
  const sale = detailQuery.data;
  const unknownPayment = sale?.payments.find((payment) => payment.status === "UNKNOWN") ?? null;

  async function reconcilePayment(outcome: ReconcileOutcome): Promise<void> {
    if (!unknownPayment) return;
    setStatusMessage("");
    setBusy(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/payments/${unknownPayment.id}/reconcile`, {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ outcome }), headers: { "Idempotency-Key": crypto.randomUUID() } },
      });
      await detailQuery.refetch();
      setStatusMessage(outcome === "SUCCEEDED" ? "Payment reconciled as succeeded." : "Payment reconciled as failed.");
      setReconcileOutcome(null);
    } catch (err) {
      setStatusMessage(err instanceof ApiError ? `${err.code}: ${err.message}` : "Payment reconciliation failed");
    } finally {
      setBusy(false);
    }
  }

  async function refundAction(mode: RefundMode): Promise<void> {
    if (!sale) return;
    setStatusMessage("");
    setBusy(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      const path = mode === "request" ? `/api/v1/sales/${sale.id}/refund-request` : mode === "approve" ? `/api/v1/sales/${sale.id}/refund-approve` : `/api/v1/sales/${sale.id}/refund-reject`;
      const body = mode === "approve"
        ? {
            saleId: sale.id,
            items: sale.items.filter((line) => Number(qtyByLine[line.id] ?? 0) > 0).map((line) => ({ saleItemId: line.id, qty: Number(qtyByLine[line.id]) })),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }
        : { reason: reason.trim() };
      await apiFetch(path, {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify(body),
          ...(mode !== "reject" ? { headers: { "Idempotency-Key": crypto.randomUUID() } } : {}),
        },
      });
      await detailQuery.refetch();
      setStatusMessage(mode === "request" ? "Refund request recorded." : mode === "approve" ? "Refund approved and recorded." : "Refund request rejected.");
      setRefundMode(null);
      setReason("");
      setQtyByLine({});
    } catch (err) {
      setStatusMessage(err instanceof ApiError ? `${err.code}: ${err.message}` : "Refund action failed");
    } finally {
      setBusy(false);
    }
  }

  if (detailQuery.isError || (!detailQuery.isLoading && !sale)) {
    return <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}><main className="mx-auto max-w-[1240px] p-6"><Panel className="border-[#efb9b9] bg-[#fff0f0] p-6"><p role="alert" className="text-sm font-medium text-[#c43e3e]">Sale not found.</p><Link href="/sales" className="mt-3 inline-block text-sm font-semibold text-[#e44e34]">← Back to sales</Link></Panel></main></AppShell>;
  }

  const refundable = sale && canRefund && ["COMPLETED", "REFUND_REQUESTED", "PARTIALLY_REFUNDED"].includes(sale.status);

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Sales / Transaction detail"
          title={sale ? `Sale ${sale.receiptNo}` : "Sale"}
          description="Review the authoritative sale, tender state, refunds and receipt without retrying uncertain payments blindly."
          actions={
            <>
              <Link href="/sales" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Sales</Link>
              {sale && ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(sale.status) ? <Link href={`/receipts/${sale.id}`} className="inline-flex min-h-10 items-center rounded-[10px] bg-[#f35d3f] px-4 text-sm font-semibold text-white hover:bg-[#d94a30]">View receipt</Link> : null}
            </>
          }
        />

        {sale ? (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Sale summary">
            <MetricCard label="Total" value={`₱${money(sale.totalMinor)}`} icon="₱" meta={`${sale.items.length} line(s)`} />
            <MetricCard label="Paid" value={`₱${money(sale.paidMinor)}`} icon="✓" tone="success" meta={`${sale.payments.length} payment(s)`} />
            <MetricCard label="Change" value={`₱${money(sale.changeMinor)}`} icon="↩" tone="info" meta="Recorded change" />
            <MetricCard label="Status" value={<span className="text-base">{sale.status}</span>} icon="▦" tone={sale.status === "COMPLETED" ? "success" : sale.status === "PAYMENT_UNKNOWN" ? "warning" : "info"} meta={sale.customer ? sale.customer.name : sale.customerName ?? "Walk-in"} />
          </section>
        ) : null}

        {statusMessage ? <div role="status" className="rounded-xl border border-[#eadfd6] bg-white px-4 py-3 text-sm font-medium text-[#655b53]">{statusMessage}</div> : null}

        {sale?.status === "PAYMENT_UNKNOWN" && unknownPayment ? (
          <Panel className="border-[#f1d6a7] bg-[#fff8eb] p-5">
            <SectionHeader title="Payment outcome is unknown" description="Do not create a second payment and do not retry this sale using a new idempotency key. Reconcile the provider outcome first." />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <StatusPill tone="warn">PAYMENT_UNKNOWN</StatusPill>
              <span className="font-data text-[11px] text-[#73685f]">{methodLabel(unknownPayment.method)} · ₱{money(unknownPayment.amountMinor)}</span>
            </div>
            {canReconcile ? <div className="mt-4 flex flex-wrap gap-2"><PrimaryButton type="button" onClick={() => setReconcileOutcome("SUCCEEDED")}>Mark succeeded</PrimaryButton><DangerButton type="button" onClick={() => setReconcileOutcome("FAILED")}>Mark failed</DangerButton></div> : <p className="mt-4 text-sm text-[#8a5606]">Ask an owner or manager to reconcile this payment.</p>}
          </Panel>
        ) : null}

        {sale ? (
          <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
            <DataTableFrame>
              <div className="px-5 py-4"><SectionHeader title="Sale lines" description="Amounts come from the recorded transaction, not current catalog pricing." /></div>
              <table className="premium-table min-w-[620px] text-left text-[12px]">
                <thead><tr><th className="px-5 pb-3">Item</th><th className="px-5 pb-3 text-right">Qty</th><th className="px-5 pb-3 text-right">Unit price</th><th className="px-5 pb-3 text-right">Line total</th></tr></thead>
                <tbody>{sale.items.map((line) => <tr key={line.id}><td className="px-5 py-3 font-semibold text-[#2a241f]">{line.name}</td><td className="font-data px-5 py-3 text-right">{line.qty}</td><td className="font-data px-5 py-3 text-right text-[#73685f]">₱{money(line.priceMinor)}</td><td className="font-data px-5 py-3 text-right font-semibold">₱{money(line.lineTotalMinor)}</td></tr>)}</tbody>
              </table>
              <div className="grid gap-2 border-t border-[#eee6de] px-5 py-4 text-[11px] sm:grid-cols-3"><div><span className="text-[#9a8d83]">Subtotal</span><p className="font-data mt-1 font-semibold">₱{money(sale.subtotalMinor)}</p></div><div><span className="text-[#9a8d83]">Discount / tax</span><p className="font-data mt-1 font-semibold">−₱{money(sale.discountMinor)} / ₱{money(sale.taxMinor)}</p></div><div className="sm:text-right"><span className="text-[#9a8d83]">Total</span><p className="font-data mt-1 font-bold">₱{money(sale.totalMinor)}</p></div></div>
            </DataTableFrame>

            <Panel className="p-5">
              <SectionHeader title="Payments" description="Tender states are shown exactly as recorded." />
              <div className="mt-4 space-y-3">{sale.payments.map((payment) => <div key={payment.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#f7f1ea] p-3"><div><p className="text-sm font-semibold text-[#2a241f]">{methodLabel(payment.method)}</p><p className="font-data mt-1 text-[11px] text-[#73685f]">₱{money(payment.amountMinor)}</p></div><StatusPill tone={statusTone(payment.status)}>{payment.status}</StatusPill></div>)}</div>
              <div className="mt-4 border-t border-[#eadfd6] pt-4 text-[11px] text-[#73685f]"><p>Customer: <strong className="text-[#2a241f]">{sale.customer ? sale.customer.name : sale.customerName ?? "Walk-in"}</strong></p><p className="mt-1">Register: <span className="font-data">{sale.registerId?.slice(0, 8) ?? "—"}</span></p></div>
            </Panel>
          </div>
        ) : <Panel className="p-6 text-sm text-[#73685f]">Loading sale…</Panel>}

        {sale ? (
          <DataTableFrame>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><SectionHeader title="Refund history" description="Refund requests and approvals remain attached to this sale." />{refundable ? <div className="flex flex-wrap gap-2">{sale.status === "REFUND_REQUESTED" ? <><PrimaryButton type="button" onClick={() => setRefundMode("approve")}>Approve refund</PrimaryButton><DangerButton type="button" onClick={() => setRefundMode("reject")}>Reject request</DangerButton></> : <GhostButton type="button" onClick={() => setRefundMode("request")}>Request refund</GhostButton>}</div> : null}</div>
            {sale.refunds.length === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No refunds recorded.</p> : (
              <table className="premium-table min-w-[760px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Status</th><th className="px-5 pb-3">Reason</th><th className="px-5 pb-3">Requested by</th><th className="px-5 pb-3 text-right">Amount</th></tr></thead><tbody>{sale.refunds.map((refund) => <tr key={refund.id}><td className="px-5 py-3"><StatusPill tone={statusTone(refund.status)}>{refund.status}</StatusPill></td><td className="px-5 py-3 text-[#73685f]">{refund.reason ?? "—"}</td><td className="font-data px-5 py-3 text-[#9a8d83]">{refund.requestedBy.slice(0, 8)}</td><td className="font-data px-5 py-3 text-right font-semibold">₱{money(refund.totalMinor)}</td></tr>)}</tbody></table>
            )}
          </DataTableFrame>
        ) : null}
      </main>

      <ConfirmDialog
        open={reconcileOutcome !== null}
        onCancel={() => !busy && setReconcileOutcome(null)}
        onConfirm={() => reconcileOutcome && void reconcilePayment(reconcileOutcome)}
        busy={busy}
        tone={reconcileOutcome === "FAILED" ? "danger" : "primary"}
        title={reconcileOutcome === "SUCCEEDED" ? "Mark payment as succeeded?" : "Mark payment as failed?"}
        description="This resolves PAYMENT_UNKNOWN. Confirm the outcome from the payment provider or settlement records before continuing."
        confirmLabel={reconcileOutcome === "SUCCEEDED" ? "Confirm succeeded" : "Confirm failed"}
        details={unknownPayment ? <span>{methodLabel(unknownPayment.method)} · <strong className="font-data text-[#2a241f]">₱{money(unknownPayment.amountMinor)}</strong></span> : null}
      />

      <Modal
        open={refundMode !== null && sale !== undefined}
        onClose={() => !busy && setRefundMode(null)}
        title={refundMode === "request" ? "Request refund" : refundMode === "approve" ? "Approve refund" : "Reject refund request"}
        description={refundMode === "approve" ? "Choose the exact quantities to refund. The backend computes authoritative refund amounts from the sale lines." : "Record a clear reason so the refund decision remains auditable."}
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setRefundMode(null)} disabled={busy}>Cancel</GhostButton>{refundMode === "reject" ? <DangerButton type="button" disabled={busy || !reason.trim()} onClick={() => void refundAction("reject")}>{busy ? "Working…" : "Reject request"}</DangerButton> : <PrimaryButton type="button" disabled={busy || (refundMode === "request" && !reason.trim()) || (refundMode === "approve" && !Object.values(qtyByLine).some((value) => Number(value) > 0))} onClick={() => refundMode && void refundAction(refundMode)}>{busy ? "Working…" : refundMode === "request" ? "Submit request" : "Approve refund"}</PrimaryButton>}</div>}
      >
        <div className="space-y-4">
          {refundMode === "approve" && sale ? <div className="space-y-3">{sale.items.map((line) => <label key={line.id} className="grid grid-cols-[minmax(0,1fr)_120px] items-end gap-3 rounded-xl border border-[#eee4db] bg-white p-3"><span className="text-[11px] font-semibold text-[#655b53]">{line.name}<span className="mt-1 block font-normal text-[#9a8d83]">Sold {line.qty} · ₱{money(line.lineTotalMinor)}</span></span><input type="number" min={0} max={line.qty} step={1} value={qtyByLine[line.id] ?? ""} onChange={(event) => setQtyByLine((previous) => ({ ...previous, [line.id]: event.target.value }))} className="field" placeholder="0" /></label>)}</div> : null}
          <label className="block text-[11px] font-semibold text-[#655b53]">Reason {refundMode === "approve" ? "(optional)" : "(required)"}<textarea autoFocus={refundMode !== "approve"} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="field mt-1.5 resize-none" placeholder="Reason for this refund decision" /></label>
          {statusMessage.includes(":") ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{statusMessage}</p> : null}
        </div>
      </Modal>
    </AppShell>
  );
}
