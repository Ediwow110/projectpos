"use client";

import { useRef, useState } from "react";
import type { JSX } from "react";

import { apiFetch } from "../lib/api";
import { canRetryPayment, retryFailureCopy, retryIntentFor, retryRequestBody, type RetryIntent } from "../lib/order-retry";
import type { PublicOrderStatus, PublicPaymentMethod } from "../lib/orders";

const METHODS: readonly PublicPaymentMethod[] = ["card", "gcash", "maya", "qrph"];

export function OrderPaymentRetry({ order }: { order: PublicOrderStatus }): JSX.Element | null {
  const [method, setMethod] = useState<PublicPaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const intent = useRef<RetryIntent | null>(null);

  if (!canRetryPayment(order)) return null;

  async function retry(): Promise<void> {
    const body = retryRequestBody(method);
    if (!body) {
      setError("Choose how you want to pay first.");
      return;
    }
    setBusy(true);
    setError("");
    const next = retryIntentFor(intent.current, body.paymentMethod);
    intent.current = next;
    try {
      const out = await apiFetch<{ checkoutUrl: string }>(`/api/v1/public/orders/${order.id}/payment/retry`, {
        init: { method: "POST", headers: { "Idempotency-Key": next.key }, body: JSON.stringify(body) },
      });
      window.location.assign(out.checkoutUrl);
    } catch (cause) {
      setError(retryFailureCopy(cause));
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-[10px] border border-[#e4d9d0] bg-[#fcf8f3] p-4" aria-labelledby="order-retry-heading">
      <h3 id="order-retry-heading" className="text-[12px] font-semibold text-[#2a241f]">Pay again</h3>
      <p className="mt-1 text-[11px] leading-5 text-[var(--color-atlas-muted-strong)]">
        Checkout stays open for two hours in the browser that placed this order. Your card is charged once even if this attempt is repeated.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">Payment method</span>
          <select
            data-ui="order-retry-method"
            className="mt-1 min-h-11 rounded-xl border border-[#e4d9d0] bg-white px-3 text-[12px] font-semibold text-[#2a241f]"
            value={method ?? ""}
            onChange={(event) => setMethod(event.target.value === "" ? null : (event.target.value as PublicPaymentMethod))}
          >
            <option value="">Choose a method</option>
            {METHODS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <button
          data-ui="order-retry-submit"
          type="button"
          disabled={busy}
          onClick={() => void retry()}
          className="min-h-11 rounded-[9px] bg-[#17130f] px-4 text-[12px] font-semibold text-white hover:bg-[#34302c] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Opening checkout…" : "Retry payment"}
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-[12px] font-medium text-[#a13535]">{error}</p> : null}
    </section>
  );
}
