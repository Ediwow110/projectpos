"use client";

import type { JSX } from "react";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NexposLogo } from "../../components/brand/NexposLogo";
import { GuestSupportForm } from "../../components/GuestSupportForm";
import { OrderPaymentRetry } from "../../components/OrderPaymentRetry";
import { ApiError, apiFetch } from "../../lib/api";
import { consumeStatusTokenFromLocation } from "../../lib/order-status-token";
import { formatOrderMoney, paymentStatusCopy, type PublicOrderStatus } from "../../lib/orders";

function fulfillmentHeadline(status: PublicOrderStatus): string {
  const latest = status.fulfillments.at(-1)?.status;
  if (status.status === "COMPLETED") return "Order completed";
  if (status.status === "CANCELLED") return "Order cancelled";
  if (status.status === "EXPIRED") return "Order expired";
  if (status.status === "REJECTED") return "Order not accepted";
  if (status.paymentMode === "PAY_AT_PICKUP" && status.status === "SUBMITTED") return "Awaiting staff confirmation";
  if (latest === "READY") return "Ready for pickup";
  if (latest === "DISPATCHED") return "Out for delivery";
  if (latest === "DELIVERY_FAILED") return "Delivery needs attention";
  if (status.status === "CONFIRMED") return "Order confirmed";
  return "Order submitted";
}

function fulfillmentCopy(status: PublicOrderStatus): string {
  const latest = status.fulfillments.at(-1)?.status;
  if (status.paymentMode === "PAY_AT_PICKUP" && status.status === "SUBMITTED") {
    return "The store has your request. Stock remains on a timed hold until staff accepts the order.";
  }
  if (latest === "READY") return "Your pickup is prepared. Bring your order link when you collect it.";
  if (latest === "DISPATCHED") return "Your delivery has left the store.";
  if (latest === "DELIVERY_FAILED") return "The store could not complete the delivery. Check your email for the next update.";
  if (status.status === "CONFIRMED") return "The store confirmed your order and is preparing fulfillment.";
  if (status.status === "COMPLETED") return "The store recorded the physical handoff as complete.";
  if (status.status === "CANCELLED") return "This order was cancelled. Any financial reversal is shown separately below.";
  if (status.status === "EXPIRED") return "The reservation window ended before the order was confirmed.";
  if (status.status === "REJECTED") return "The store could not accept this order.";
  return "The store has received your order.";
}

function OrderStatusExperience(): JSX.Element {
  const params = useSearchParams();
  const paymentReturn = params.get("payment");
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<PublicOrderStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [neutralReturn, setNeutralReturn] = useState(false);

  async function loadStatus(token: string): Promise<void> {
    setLoading(true);
    setError("");
    try {
      setStatus(await apiFetch<PublicOrderStatus>("/api/v1/public/orders/status", {
        init: { method: "POST", body: JSON.stringify({ token }) },
      }));
    } catch (cause) {
      setStatus(null);
      if (cause instanceof ApiError && (cause.code === "NOT_FOUND" || cause.status === 404)) {
        setError("This secure order link is invalid or expired.");
      } else if (cause instanceof ApiError && cause.code === "RATE_LIMITED") {
        setError("Too many status checks. Wait a moment, then try again.");
      } else {
        setError("Could not load the order status. Try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const token = consumeStatusTokenFromLocation(window.location, window.history);
    if (token) {
      tokenRef.current = token;
      setNeutralReturn(false);
      void loadStatus(token);
      return;
    }
    if (paymentReturn === "success" || paymentReturn === "cancelled") {
      setNeutralReturn(true);
      return;
    }
    setError("Open the secure status link from your order email.");
  }, [paymentReturn]);

  if (neutralReturn && !status) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fcf8f3] px-5 py-10">
        <section className="w-full max-w-xl rounded-[16px] border border-[#eee4db] bg-white p-7 shadow-[0_18px_48px_-24px_rgb(28_20_15/0.28)] sm:p-9">
          <NexposLogo size="md" />
          <h1 className="font-display mt-8 text-[30px] font-bold tracking-[-0.035em]">Payment return received</h1>
          <p role="status" className="mt-4 text-sm leading-6 text-[#73685f]">
            Check your email for your secure order status link. This return page does not confirm that payment succeeded.
          </p>
          <a href="/order-status" className="mt-7 inline-flex min-h-11 items-center justify-center rounded-[9px] border border-[#e4d9d0] bg-white px-4 text-[12px] font-semibold text-[#2a241f] hover:border-[#f35d3f] hover:text-[var(--color-atlas-accent-strong)]">
            Open a secure status link
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f8f5] px-5 py-7 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-[1300px]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e5e9e3] pb-5">
          <NexposLogo size="md" />
          <div className="flex flex-wrap items-center gap-4"><Link href="/order-help" className="text-[13px] font-semibold text-[#53615a] hover:underline">Order help</Link><span className="font-data text-[10px] uppercase tracking-[0.12em] text-[var(--color-atlas-muted-strong)]">Secure order status</span></div>
        </header>

        {loading && !status ? (
          <section className="mt-8 max-w-3xl rounded-[16px] border border-[#eee4db] bg-white px-6 py-16 text-center shadow-[0_14px_36px_-24px_rgb(28_20_15/0.22)]">
            <p role="status" aria-live="polite" className="font-data text-sm text-[#73685f]">Loading secure order status…</p>
          </section>
        ) : error ? (
          <section className="mt-8 max-w-3xl rounded-[16px] border border-[#efc9c9] bg-white p-7 shadow-[0_14px_36px_-24px_rgb(28_20_15/0.22)]">
            <h1 className="font-display text-2xl font-bold">Status unavailable</h1>
            <p role="alert" className="mt-3 text-sm leading-6 text-[#a13535]">{error}</p>
            {tokenRef.current ? (
              <button
                type="button"
                onClick={() => tokenRef.current && void loadStatus(tokenRef.current)}
                className="mt-6 min-h-11 rounded-[9px] bg-[#17130f] px-4 text-[12px] font-semibold text-white hover:bg-[#34302c]"
              >
                Try again
              </button>
            ) : null}
          </section>
        ) : status ? (
          <section className="mt-8 max-w-3xl overflow-hidden rounded-[18px] border border-[#e5d9cf] bg-white shadow-[0_20px_56px_-28px_rgb(28_20_15/0.30)]">
            <div className="bg-[#252422] px-6 py-7 text-white sm:px-8">
              <p className="font-data text-[9px] uppercase tracking-[0.13em] text-[#ff8061]">Order {status.id.slice(-8).toUpperCase()}</p>
              <h1 id="order-status-summary" tabIndex={-1} className="font-display mt-3 scroll-mt-6 text-[30px] font-bold tracking-[-0.035em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:text-[36px]">{fulfillmentHeadline(status)}</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[#c9beb5]">{fulfillmentCopy(status)}</p>
              <a href="#order-support" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg border border-[#819089] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Report an order issue ↓</a>
            </div>

            <div className="grid gap-6 px-6 py-6 sm:px-8">
              <section aria-labelledby="payment-status-heading" className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                <div>
                  <h2 id="payment-status-heading" className="text-[12px] font-semibold text-[#655b53]">Payment</h2>
                  <p className={"mt-2 text-sm font-semibold " + (status.paymentStatus === "UNKNOWN" || status.paymentStatus === "FAILED" ? "text-[var(--color-atlas-warning-strong)]" : status.paymentStatus === "PAID" ? "text-[var(--color-atlas-verified)]" : "text-[#2a241f]")}>
                    {status.paymentStatus.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-[#73685f]">{paymentStatusCopy(status.paymentStatus)}</p>
                  <OrderPaymentRetry order={status} />
                </div>
                <div className="rounded-[10px] bg-[#f7f1ea] px-4 py-3 text-right">
                  <span className="font-data text-[9px] uppercase tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">Total</span>
                  <p className="font-data mt-1 text-[16px] font-bold">{formatOrderMoney(status.totalMinor, status.currency)}</p>
                </div>
              </section>

              <div className="border-t border-dashed border-[#d9c9bd]" />

              <section aria-labelledby="order-lines-heading">
                <h2 id="order-lines-heading" className="text-[12px] font-semibold text-[#655b53]">Order lines</h2>
                <ul className="mt-3 divide-y divide-[#eee6de]">
                  {status.lines.map((line) => (
                    <li key={line.id} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold">{line.name}</p>
                        <p className="mt-1 font-data text-[9px] text-[#8d8178]">{line.qty} × {formatOrderMoney(line.priceMinor, status.currency)}</p>
                      </div>
                      <span className="font-data text-[11px] font-semibold">{formatOrderMoney(line.lineTotalMinor + line.taxMinor - line.discountMinor, status.currency)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="border-t border-dashed border-[#d9c9bd]" />

              <section className="grid gap-2 text-[11px]">
                <div className="flex justify-between gap-4"><span className="text-[#73685f]">Subtotal</span><span className="font-data">{formatOrderMoney(status.subtotalMinor, status.currency)}</span></div>
                <div className="flex justify-between gap-4"><span className="text-[#73685f]">Tax</span><span className="font-data">{formatOrderMoney(status.taxMinor, status.currency)}</span></div>
                {status.deliveryFeeMinor > 0 ? <div className="flex justify-between gap-4"><span className="text-[#73685f]">Delivery</span><span className="font-data">{formatOrderMoney(status.deliveryFeeMinor, status.currency)}</span></div> : null}
                {status.deliveryTaxMinor > 0 ? <div className="flex justify-between gap-4"><span className="text-[#73685f]">Delivery tax</span><span className="font-data">{formatOrderMoney(status.deliveryTaxMinor, status.currency)}</span></div> : null}
              </section>

              {tokenRef.current ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eee4db] pt-5">
                  <p className="text-[10px] leading-4 text-[var(--color-atlas-muted-strong)]">This page keeps the secure token only in memory. Refresh through this control instead of copying the browser URL.</p>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => tokenRef.current && void loadStatus(tokenRef.current)}
                    className="min-h-10 rounded-[9px] border border-[#e4d9d0] bg-white px-4 text-[11px] font-semibold text-[#2a241f] hover:border-[#f35d3f] hover:text-[var(--color-atlas-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? "Refreshing…" : "Refresh status"}
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
        {status && tokenRef.current ? <div id="order-support" className="mt-10 scroll-mt-6 border-t border-[#e5e9e3] pt-8"><GuestSupportForm statusToken={tokenRef.current} orderReference={status.id.slice(-8).toUpperCase()} /></div> : null}
      </div>
    </main>
  );
}

export default function OrderStatusPage(): JSX.Element {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#fcf8f3]"><p role="status">Loading secure order status…</p></main>}>
      <OrderStatusExperience />
    </Suspense>
  );
}
