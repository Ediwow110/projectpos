"use client";

import type { JSX } from "react";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";

interface Me {
  role: string;
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

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export default function SaleDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [reconciling, setReconciling] = useState(false);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const detailQuery = useQuery({
    queryKey: ["sale", id],
    queryFn: () => apiFetch<SaleDetail>("/api/v1/sales/" + id),
    retry: false,
  });

  const role = meQuery.data?.role ?? "cashier";
  const canRefund = role === "owner" || role === "manager" || role === "inventory";
  const canReconcile = role === "owner" || role === "manager";

  async function reconcilePayment(paymentId: string, outcome: "SUCCEEDED" | "FAILED"): Promise<void> {
    setStatus("");
    setReconciling(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/payments/" + paymentId + "/reconcile", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({ outcome }),
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      });
      await detailQuery.refetch();
      setStatus(outcome === "SUCCEEDED" ? "Payment reconciled as succeeded." : "Payment reconciled as failed.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Payment reconciliation failed");
    } finally {
      setReconciling(false);
    }
  }

  async function refundAction(path: string, body: unknown, key?: string): Promise<void> {
    setStatus("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(path, {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify(body),
          ...(key ? { headers: { "Idempotency-Key": key } } : {}),
        },
      });
      await detailQuery.refetch();
      setStatus("Refund action recorded.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Refund action failed");
    }
  }

  if (detailQuery.isLoading) return <main>Loading sale…</main>;
  if (detailQuery.isError || !detailQuery.data)
    return (
      <main>
        <p role="alert">Sale not found.</p>
        <Link href="/sales">Back to sales</Link>
      </main>
    );

  const s = detailQuery.data;
  const unknownPayment = s.payments.find((payment) => payment.status === "UNKNOWN") ?? null;
  return (
    <main>
      <Link href="/sales">Back to sales</Link>
      <h1>Sale {s.receiptNo}</h1>
      <p>Status: {s.status}</p>
      <p>Customer: {s.customer ? s.customer.name : (s.customerName ?? "Walk-in")}</p>
      <section aria-label="Lines">
        <h2>Lines</h2>
        <ul>
          {s.items.map((l) => (
            <li key={l.id} style={{ fontVariantNumeric: "tabular-nums" }}>
              {l.name} × {l.qty} — {money(l.lineTotalMinor)}
            </li>
          ))}
        </ul>
        <p style={{ fontVariantNumeric: "tabular-nums" }}>
          Subtotal {money(s.subtotalMinor)} — Discount {money(s.discountMinor)} — Tax {money(s.taxMinor)} —
          Total {money(s.totalMinor)} — Paid {money(s.paidMinor)} — Change {money(s.changeMinor)}
        </p>
      </section>
      <section aria-label="Payments">
        <h2>Payments</h2>
        <ul>
          {s.payments.map((p) => (
            <li key={p.id} style={{ fontVariantNumeric: "tabular-nums" }}>
              {p.method}: {money(p.amountMinor)} ({p.status})
            </li>
          ))}
        </ul>
      </section>
      {s.status === "PAYMENT_UNKNOWN" && unknownPayment ? (
        <section aria-label="Payment reconciliation">
          <h2>Payment needs reconciliation</h2>
          <p>
            The provider outcome is unknown. Do not create a second payment or retry the sale with a new key.
          </p>
          {canReconcile ? (
            <div>
              <button
                type="button"
                disabled={reconciling}
                onClick={() => void reconcilePayment(unknownPayment.id, "SUCCEEDED")}
              >
                Mark payment succeeded
              </button>
              <button
                type="button"
                disabled={reconciling}
                onClick={() => void reconcilePayment(unknownPayment.id, "FAILED")}
              >
                Mark payment failed
              </button>
            </div>
          ) : (
            <p>Ask an owner or manager to reconcile this payment.</p>
          )}
        </section>
      ) : null}
      <section aria-label="Refunds">
        <h2>Refunds</h2>
        {s.refunds.length === 0 && <p>No refunds recorded.</p>}
        {s.refunds.map((r) => (
          <article key={r.id}>
            <p style={{ fontVariantNumeric: "tabular-nums" }}>
              {r.status} — {money(r.totalMinor)} — requested by {r.requestedBy}, approved by {r.approvedBy}
              {r.reason ? " — " + r.reason : ""}
            </p>
            <ul>
              {r.items.map((i, idx) => (
                <li key={idx}>Line {i.saleItemId.slice(0, 8)} × {i.qty} — {money(i.amountMinor)}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      {canRefund && (s.status === "COMPLETED" || s.status === "REFUND_REQUESTED" || s.status === "PARTIALLY_REFUNDED") && (
        <section aria-label="Refund actions">
          <h2>Refund</h2>
          {s.items.map((l) => (
            <label key={l.id}>
              Refund qty for {l.name} (sold {l.qty})
              <input
                value={qtyByLine[l.id] ?? ""}
                onChange={(e) => setQtyByLine((prev) => ({ ...prev, [l.id]: e.target.value }))}
                inputMode="numeric"
                placeholder="0"
              />
            </label>
          ))}
          <label>
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required for requests" />
          </label>
          <div>
            <button
              onClick={() =>
                void refundAction("/api/v1/sales/" + s.id + "/refund-request", { reason }, crypto.randomUUID())
              }
            >
              Request refund
            </button>
            <button
              onClick={() =>
                void refundAction(
                  "/api/v1/sales/" + s.id + "/refund-approve",
                  {
                    saleId: s.id,
                    items: s.items
                      .filter((l) => Number(qtyByLine[l.id] ?? 0) > 0)
                      .map((l) => ({ saleItemId: l.id, qty: Number(qtyByLine[l.id]) })),
                    ...(reason.trim() !== "" ? { reason } : {}),
                  },
                  crypto.randomUUID(),
                )
              }
            >
              Approve refund
            </button>
            <button
              onClick={() => void refundAction("/api/v1/sales/" + s.id + "/refund-reject", { reason })}
            >
              Reject request
            </button>
          </div>
        </section>
      )}
      {s.status === "COMPLETED" || s.status === "PARTIALLY_REFUNDED" || s.status === "REFUNDED" ? (
        <p>
          <Link href={"/receipts/" + s.id}>View receipt</Link>
        </p>
      ) : null}
      {status !== "" && <p role="status">{status}</p>}
    </main>
  );
}
