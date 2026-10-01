"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { ManagerApprovalDialog } from "../../../components/ManagerApprovalDialog";
import { Modal } from "../../../components/Modal";
import { SaleExchangeDialog } from "../../../components/SaleExchangeDialog";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { DangerButton, GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { buildProductSearch } from "../../../lib/catalog";

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

interface ExchangeRow {
  id: string;
  originalSaleId: string;
  refundId: string;
  replacementSaleId: string;
  returnMinor: number;
  replacementMinor: number;
  netMinor: number;
  direction: "COLLECT" | "REFUND" | "EVEN";
  reason: string;
  actorId: string;
  requestId: string;
  createdAt: string;
}

interface ExchangeOriginRow extends ExchangeRow {
  originalReceiptNo: string;
}

interface ExchangeProduct {
  id: string;
  name: string;
  priceMinor: number;
  taxRateBps: number | null;
}

interface BusinessPayload {
  settings: Record<string, unknown>;
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
  exchanges: ExchangeRow[];
  exchangeOrigin: ExchangeOriginRow | null;
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
  if (method === "qrph") return "QR Ph";
  if (method === "gcash") return "GCash";
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
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangeSearch, setExchangeSearch] = useState("");
  const [exchangeError, setExchangeError] = useState("");
  const [approvalKind, setApprovalKind] = useState<"refund" | "void" | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const detailQuery = useQuery({
    queryKey: ["sale", id],
    queryFn: () => apiFetch<SaleDetail>(`/api/v1/sales/${id}`),
    retry: false,
    refetchInterval: (query) => {
      const current = query.state.data as SaleDetail | undefined;
      return current?.status === "PENDING_PAYMENT" ? 2_000 : false;
    },
  });
  const businessQuery = useQuery({
    queryKey: ["business"],
    queryFn: () => apiFetch<BusinessPayload>("/api/v1/business"),
    retry: false,
  });
  const exchangeProductsQuery = useQuery({
    queryKey: ["exchange-products", exchangeSearch],
    queryFn: () => apiFetch<{ items: ExchangeProduct[] }>(buildProductSearch({
      q: exchangeSearch.trim() || undefined,
      active: "true",
      page: 1,
      pageSize: 20,
    })),
    enabled: exchangeOpen,
    retry: false,
  });

  const role = meQuery.data?.role ?? "cashier";
  const canRefund = role === "owner" || role === "manager" || role === "inventory" || role === "cashier";
  const canReconcile = role === "owner" || role === "manager";
  const sale = detailQuery.data;
  const successfulPayments = sale?.payments.filter((payment) => payment.status === "SUCCEEDED") ?? [];
  const cashSettled = successfulPayments.length > 0 && successfulPayments.every((payment) => payment.method === "cash");
  const canExchange = Boolean(
    sale &&
    (role === "owner" || role === "manager") &&
    ["COMPLETED", "PARTIALLY_REFUNDED"].includes(sale.status) &&
    sale.registerId &&
    cashSettled,
  );
  const unknownPayment = sale?.payments.find((payment) => payment.status === "UNKNOWN") ?? null;
  const paymongoPayment = sale?.payments.find(
    (payment) => ["card", "gcash", "maya", "qrph"].includes(payment.method) && ["PENDING", "SUCCEEDED", "FAILED"].includes(payment.status),
  ) ?? null;

  async function continuePayMongo(): Promise<void> {
    if (!sale || !paymongoPayment || !["card", "gcash", "maya", "qrph"].includes(paymongoPayment.method)) return;
    setStatusMessage("");
    setBusy(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      const checkout = await apiFetch<{ checkoutUrl: string }>(`/api/v1/sales/${sale.id}/paymongo/checkout`, {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({ method: paymongoPayment.method }),
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      });
      window.location.assign(checkout.checkoutUrl);
    } catch (err) {
      setStatusMessage(err instanceof ApiError ? `${err.code}: ${err.message}` : "Could not resume PayMongo checkout");
      setBusy(false);
    }
  }

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

  async function refundAction(mode: RefundMode, approvalToken?: string): Promise<boolean> {
    if (!sale) return false;
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
          ...(approvalToken ? { body: JSON.stringify({ ...body, approvalToken }) } : {}),
          ...(mode !== "reject" ? { headers: { "Idempotency-Key": crypto.randomUUID() } } : {}),
        },
      });
      await detailQuery.refetch();
      setStatusMessage(mode === "request" ? "Refund request recorded." : mode === "approve" ? "Refund approved and recorded." : "Refund request rejected.");
      setRefundMode(null);
      setReason("");
      setQtyByLine({});
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "FORBIDDEN" && mode === "approve" && !approvalToken) {
        setRefundMode(null);
        setApprovalKind("refund");
      } else {
        setStatusMessage(err instanceof ApiError ? `${err.code}: ${err.message}` : "Refund action failed");
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function voidSale(approvalToken?: string): Promise<boolean> {
    if (!sale) return false;
    setBusy(true);
    setStatusMessage("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/sales/${sale.id}/void`, { csrfToken: csrf.csrfToken, init: { method: "POST", body: JSON.stringify({ reason: voidReason.trim(), ...(approvalToken ? { approvalToken } : {}) }) } });
      await detailQuery.refetch();
      setVoidOpen(false);
      setVoidReason("");
      setStatusMessage("Sale voided.");
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "FORBIDDEN" && !approvalToken) {
        setVoidOpen(false);
        setApprovalKind("void");
      } else {
        setStatusMessage(err instanceof ApiError ? `${err.code}: ${err.message}` : "Could not void sale.");
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function completeExchange(input: {
    returns: Array<{ saleItemId: string; qty: number }>;
    replacements: Array<{ productId: string; qty: number }>;
    reason: string;
  }): Promise<void> {
    if (!sale) return;
    setExchangeError("");
    setStatusMessage("");
    setBusy(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      const result = await apiFetch<{
        exchange: ExchangeRow;
        replacementSale: { id: string; receiptNo: string };
      }>(`/api/v1/sales/${sale.id}/exchange`, {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(input),
        },
      });
      await detailQuery.refetch();
      setExchangeOpen(false);
      setExchangeSearch("");
      const amount = Math.abs(result.exchange.netMinor);
      setStatusMessage(
        result.exchange.direction === "COLLECT"
          ? `Exchange completed. Collect ₱${money(amount)}. Replacement sale ${result.replacementSale.receiptNo}.`
          : result.exchange.direction === "REFUND"
            ? `Exchange completed. Refund ₱${money(amount)}. Replacement sale ${result.replacementSale.receiptNo}.`
            : `Exchange completed with no cash difference. Replacement sale ${result.replacementSale.receiptNo}.`,
      );
    } catch (err) {
      setExchangeError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Exchange failed");
    } finally {
      setBusy(false);
    }
  }

  if (detailQuery.isError || (!detailQuery.isLoading && !sale)) {
    return <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}><main className="mx-auto max-w-[1240px] p-6"><Panel className="border-[#efb9b9] bg-[#fff0f0] p-6"><p role="alert" className="text-sm font-medium text-[#c43e3e]">Sale not found.</p><Link href="/sales" className="mt-3 inline-block text-sm font-semibold text-[#e44e34]">← Back to sales</Link></Panel></main></AppShell>;
  }

  const refundable = sale && canRefund && ["COMPLETED", "REFUND_REQUESTED", "PARTIALLY_REFUNDED"].includes(sale.status);
  const refundedQtyByLine = new Map<string, number>();
  for (const refund of sale?.refunds ?? []) {
    for (const item of refund.items) {
      refundedQtyByLine.set(item.saleItemId, (refundedQtyByLine.get(item.saleItemId) ?? 0) + item.qty);
    }
  }
  const taxSetting = businessQuery.data?.settings?.["taxRateBps"];
  const businessTaxRateBps = typeof taxSetting === "number" ? taxSetting : null;
  const selectedRefundItems = sale?.items
    .filter((line) => Number(qtyByLine[line.id] ?? 0) > 0)
    .map((line) => ({ saleItemId: line.id, qty: Number(qtyByLine[line.id]) })) ?? [];
  const refundTotalMinor = selectedRefundItems.reduce((total, item) => {
    const line = sale?.items.find((candidate) => candidate.id === item.saleItemId);
    return total + (line ? Math.round((line.lineTotalMinor / line.qty) * item.qty) : 0);
  }, 0);
  const threshold = businessQuery.data?.settings?.["refundApprovalThresholdMinor"];
  const refundPermission = typeof threshold === "number" && refundTotalMinor > threshold ? "refund.override" : "sale.refund";

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
              {sale && ["DRAFT", "PENDING_PAYMENT", "PAYMENT_FAILED", "PAYMENT_UNKNOWN"].includes(sale.status) ? <DangerButton type="button" onClick={() => { setVoidReason(""); setVoidOpen(true); }}>Void sale</DangerButton> : null}
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

        {sale?.status === "PENDING_PAYMENT" && paymongoPayment ? (
          <Panel className={paymongoPayment.status === "SUCCEEDED" ? "border-[#f1d6a7] bg-[#fff8eb] p-5" : "border-[#cfdcf4] bg-[#f4f7ff] p-5"}>
            <SectionHeader
              title={paymongoPayment.status === "SUCCEEDED" ? "PayMongo payment confirmed — finalization pending" : "Waiting for PayMongo payment"}
              description={paymongoPayment.status === "SUCCEEDED"
                ? "Do not charge the customer again. PayMongo has succeeded, but NexPOS still needs to finish the local sale. The webhook will retry if a temporary inventory or database condition blocked finalization."
                : "The sale is not complete until NexPOS receives PayMongo's signed payment webhook. Returning from checkout alone never marks a payment as paid."}
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <StatusPill tone={paymongoPayment.status === "SUCCEEDED" ? "warn" : "info"}>{paymongoPayment.status}</StatusPill>
              <span className="font-data text-[11px] text-[#73685f]">{methodLabel(paymongoPayment.method)} · ₱{money(paymongoPayment.amountMinor)}</span>
              {paymongoPayment.status === "PENDING" ? <PrimaryButton type="button" onClick={() => void continuePayMongo()} disabled={busy}>{busy ? "Opening…" : "Continue secure checkout"}</PrimaryButton> : null}
            </div>
          </Panel>
        ) : null}

        {sale?.status === "PAYMENT_FAILED" && paymongoPayment?.status === "FAILED" ? (
          <Panel className="border-[#f1d6a7] bg-[#fff8eb] p-5">
            <SectionHeader title="PayMongo checkout expired or failed" description="No successful settlement was recorded. You can safely start a new hosted checkout for this sale." />
            <div className="mt-4"><PrimaryButton type="button" onClick={() => void continuePayMongo()} disabled={busy}>{busy ? "Opening…" : "Try PayMongo again"}</PrimaryButton></div>
          </Panel>
        ) : null}

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
          sale.exchangeOrigin ? (
            <section role="region" aria-label="Exchange origin">
              <Panel className="border-[#f0e2d7] bg-[#fff8f3] p-5">
                <SectionHeader
                  title="Replacement from exchange"
                  description="This sale was created as the replacement side of a linked exchange. Open the original sale to review the returned items, refund, and customer difference."
                />
                <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-[#73685f]">
                  <StatusPill tone={sale.exchangeOrigin.direction === "EVEN" ? "info" : sale.exchangeOrigin.direction === "REFUND" ? "warn" : "ok"}>
                    {sale.exchangeOrigin.direction}
                  </StatusPill>
                  <span className="font-data font-semibold text-[#2a241f]">Original {sale.exchangeOrigin.originalReceiptNo}</span>
                  <span className="font-data">Net ₱{money(Math.abs(sale.exchangeOrigin.netMinor))}</span>
                  <span>{sale.exchangeOrigin.reason}</span>
                  <Link href={`/sales/${sale.exchangeOrigin.originalSaleId}`} className="font-semibold text-[#e44e34] hover:text-[#c53f2c]">
                    Open original sale →
                  </Link>
                </div>
              </Panel>
            </section>
          ) : null
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

        {sale ? (
          <section role="region" aria-label="Exchange history">
            <DataTableFrame>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <SectionHeader
                  title="Exchange history"
                  description="Linked return and replacement transactions keep the customer cash difference auditable."
                />
                {canExchange ? (
                  <PrimaryButton type="button" onClick={() => { setExchangeError(""); setExchangeOpen(true); }}>
                    Exchange items
                  </PrimaryButton>
                ) : null}
              </div>
              {(role === "owner" || role === "manager") && ["COMPLETED", "PARTIALLY_REFUNDED"].includes(sale.status) && !cashSettled ? (
                <p className="mx-5 mb-5 rounded-xl border border-[#efd6a5] bg-[#fff8eb] px-4 py-3 text-[11px] leading-5 text-[#8a5606]">
                  Direct exchange currently supports cash-settled sales only. Use the normal refund flow for card, GCash, Maya, QR Ph, bank transfer, or mixed tenders until provider-side exchange settlement is modeled.
                </p>
              ) : null}
              {sale.exchanges.length === 0 ? (
                <p className="px-5 pb-8 text-sm text-[#8b8077]">No exchanges recorded.</p>
              ) : (
                <table className="premium-table min-w-[900px] text-left text-[12px]">
                  <thead><tr><th className="px-5 pb-3">Direction</th><th className="px-5 pb-3">Reason</th><th className="px-5 pb-3 text-right">Return</th><th className="px-5 pb-3 text-right">Replacement</th><th className="px-5 pb-3 text-right">Net</th><th className="px-5 pb-3">Replacement sale</th></tr></thead>
                  <tbody>{sale.exchanges.map((exchange) => (
                    <tr key={exchange.id}>
                      <td className="px-5 py-3"><StatusPill tone={exchange.direction === "EVEN" ? "info" : exchange.direction === "REFUND" ? "warn" : "ok"}>{exchange.direction}</StatusPill></td>
                      <td className="px-5 py-3 text-[#73685f]">{exchange.reason}</td>
                      <td className="font-data px-5 py-3 text-right">₱{money(exchange.returnMinor)}</td>
                      <td className="font-data px-5 py-3 text-right">₱{money(exchange.replacementMinor)}</td>
                      <td className="font-data px-5 py-3 text-right font-semibold">₱{money(Math.abs(exchange.netMinor))}</td>
                      <td className="px-5 py-3"><Link href={`/sales/${exchange.replacementSaleId}`} className="font-semibold text-[#e44e34] hover:text-[#c53f2c]">Open replacement sale →</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </DataTableFrame>
          </section>
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

      <Modal open={voidOpen && sale !== undefined} onClose={() => !busy && setVoidOpen(false)} title="Void sale" description="Voiding prevents this unsettled sale from continuing. The reason is retained in the audit trail." footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setVoidOpen(false)} disabled={busy}>Cancel</GhostButton><DangerButton type="button" disabled={busy || voidReason.trim().length < 3} onClick={() => void voidSale()}>{busy ? "Voiding…" : "Void sale"}</DangerButton></div>}><label className="block text-[11px] font-semibold text-[#655b53]">Reason<textarea autoFocus value={voidReason} onChange={(event) => setVoidReason(event.target.value)} rows={3} className="field mt-1.5 resize-none" placeholder="Why this sale is being voided" /></label>{statusMessage.includes(":") ? <p role="alert" className="mt-3 rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{statusMessage}</p> : null}</Modal>

      {sale && approvalKind === "refund" ? <ManagerApprovalDialog open permission={refundPermission} action={{ kind: "refund", saleId: sale.id, items: selectedRefundItems, ...(reason.trim() ? { reason: reason.trim() } : {}) }} title={`Manager approval · approve refund of ₱${money(refundTotalMinor)}`} description="Approving this refund requires a manager authorization for the exact selected items." summary={`${selectedRefundItems.length} item line(s) · ₱${money(refundTotalMinor)}`} onApproved={(grant) => refundAction("approve", grant.token)} onClose={() => setApprovalKind(null)} /> : null}
      {sale && approvalKind === "void" ? <ManagerApprovalDialog open permission="sale.void" action={{ kind: "sale_void", saleId: sale.id, reason: voidReason.trim() }} title={`Manager approval · approve void of sale ${sale.receiptNo}`} description="Voiding an unsettled sale requires manager authorization for this exact sale and reason." summary={`Sale ${sale.receiptNo} · ${voidReason.trim()}`} onApproved={(grant) => voidSale(grant.token)} onClose={() => setApprovalKind(null)} /> : null}

      {exchangeOpen && sale ? (
        <SaleExchangeDialog
          lines={sale.items.map((line) => ({
            id: line.id,
            name: line.name,
            qty: line.qty,
            lineTotalMinor: line.lineTotalMinor,
            alreadyRefundedQty: refundedQtyByLine.get(line.id) ?? 0,
          }))}
          products={exchangeProductsQuery.data?.items ?? []}
          businessTaxRateBps={businessTaxRateBps}
          search={exchangeSearch}
          productsLoading={exchangeProductsQuery.isLoading || exchangeProductsQuery.isFetching}
          busy={busy}
          error={exchangeError}
          onSearchChange={setExchangeSearch}
          onSubmit={(input) => void completeExchange(input)}
          onClose={() => {
            if (busy) return;
            setExchangeOpen(false);
            setExchangeError("");
            setExchangeSearch("");
          }}
        />
      ) : null}
    </AppShell>
  );
}
