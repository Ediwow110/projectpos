"use client";

import type { JSX } from "react";
import { useState, useRef, useEffect } from "react";
import { ApiError, apiFetch } from "../lib/api";

interface GuestCase { caseId: string; category: string; status: string; createdAt: string }

export function GuestSupportForm({ statusToken, orderReference }: { statusToken: string; orderReference: string }): JSX.Element {
  const [category, setCategory] = useState<"ORDER" | "PAYMENT" | "FULFILLMENT" | "OTHER">("ORDER");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [history, setHistory] = useState<GuestCase[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (submitted) confirmationRef.current?.focus();
  }, [submitted]);

  function returnToOrderStatus(): void {
    const heading = document.getElementById("order-status-summary");
    if (!heading) return;
    heading.focus({ preventScroll: true });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  async function refreshHistory(): Promise<void> {
    const result = await apiFetch<{ items: GuestCase[] }>("/api/v1/public/support/history", {
      init: { method: "POST", body: JSON.stringify({ statusToken }) },
    });
    setHistory(result.items);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || description.trim().length < 10) return;
    setBusy(true); setError("");
    try {
      idempotencyKey.current ??= crypto.randomUUID();
      const result = await apiFetch<{ caseId: string; status: string }>("/api/v1/public/support/cases", {
        init: { method: "POST", body: JSON.stringify({ statusToken, category, description: description.trim() }),
          headers: { "Idempotency-Key": idempotencyKey.current } },
      });
      setSubmitted(result.caseId);
      setDescription("");
      idempotencyKey.current = null;
      await refreshHistory().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof ApiError
        ? cause.status === 429 ? "Too many requests. Wait and try again." :
          cause.status === 404 || cause.status === 403 ? "This order link is no longer valid." : "Could not submit the support case. Retry to avoid duplicating it."
        : "Support is temporarily unavailable. Retry when connected.");
    } finally { setBusy(false); }
  }

  return <section aria-label="Customer support" data-ui="atlas-guest-support" className="space-y-5 pb-24 sm:pb-0">
    <header className="space-y-2">
      <p className="font-data text-[11px] font-medium tracking-[0.08em] text-[var(--color-atlas-accent-strong)]">HELP &amp; ORDER SUPPORT</p>
      <h2 className="font-display text-[26px] font-semibold tracking-tight text-[#202826]"><span className="sm:hidden">Get order support</span><span className="hidden sm:inline">Need help with this order?</span></h2>
      <p className="text-[14px] text-[var(--color-atlas-muted-strong)] sm:hidden">No account needed</p>
      <p className="hidden text-[14px] leading-6 text-[var(--color-atlas-muted-strong)] sm:block">Your secure order status link has been verified. You do not need a new account or a separate order-reference lookup.</p>
    </header>
    {submitted ? <div role="status" className="mx-auto max-w-2xl rounded-[15px] border border-[#e5e9e3] bg-white px-5 py-9 text-center sm:px-8 sm:py-12">
      <span aria-hidden className="mx-auto grid size-[90px] place-items-center rounded-[20px] bg-[#e8f4ec] font-display text-[48px] text-[#267552]">✓</span>
      <h3 ref={confirmationRef} tabIndex={-1} className="mt-6 font-display text-[25px] font-semibold text-[#202826] focus:outline-none">Support request received</h3>
      <p className="mt-3 text-[14px] leading-6 text-[var(--color-atlas-muted-strong)]">We&apos;ve received your message. Keep this reference and your original secure order link.</p>
      <p className="mt-3 break-all font-data text-sm text-[#202826]">Reference: {submitted}</p>
      <span className="mt-5 inline-block rounded-md bg-[#fcf1df] px-4 py-2 font-data text-[11px] font-semibold text-[var(--color-atlas-warning-strong)]">AWAITING REVIEW</span>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={returnToOrderStatus} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#29332d] px-5 text-sm font-semibold text-white hover:bg-[#35423d] motion-reduce:scroll-auto">Back to order status</button>
        <button type="button" className="min-h-11 rounded-lg border border-[#e5e9e3] px-5 text-sm font-semibold text-[#202826] hover:bg-[#f7f8f5]" onClick={() => setSubmitted(null)}>Submit another issue</button>
      </div>
    </div> : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(230px,0.48fr)]">
      <form className="min-w-0 rounded-[13px] border border-[#e5e9e3] bg-white p-5 sm:p-6" onSubmit={(event) => void submit(event)}>
        <h3 className="font-display text-[21px] font-semibold text-[#202826]">Submit an order issue</h3>
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-[var(--color-atlas-muted-strong)]">Order reference</p>
              <p className="mt-2 flex min-h-[56px] items-center rounded-lg bg-[#f7f8f5] px-4 font-data text-sm font-semibold tracking-wide text-[#202826]">{orderReference}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-atlas-muted-strong)]">Verification</p>
              <p className="mt-2 flex min-h-[56px] items-center rounded-lg bg-[#f7f8f5] px-4 text-sm font-medium text-[#267552]">Verified through secure order status link</p>
            </div>
          </div>
          <label className="block text-[13px] font-medium text-[#53615a]">What do you need help with?
            <select className="field mt-2" value={category} onChange={(event) => { setCategory(event.target.value as typeof category); idempotencyKey.current = null; }}>
              <option value="ORDER">Missing, damaged or incorrect item</option><option value="PAYMENT">Payment question</option><option value="FULFILLMENT">Pickup or delivery</option><option value="OTHER">Other</option>
            </select>
          </label>
          <label className="block text-[13px] font-medium text-[#53615a]">Describe the issue
            <textarea className="field mt-2 min-h-28" required minLength={10} maxLength={1000}
              placeholder="Tell the store what happened and how they can help" value={description}
              onChange={(event) => { setDescription(event.target.value); idempotencyKey.current = null; }} />
          </label>
          {error && <p role="alert" className="text-sm text-[#a34132]">{error}</p>}
          <div className="flex justify-end"><button type="submit" disabled={busy || description.trim().length < 10} className="fixed inset-x-4 bottom-4 z-[70] min-h-[53px] rounded-lg bg-[#29332d] px-5 text-[13px] font-semibold text-white shadow-[0_0_0_12px_white] hover:bg-[#35423d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c] disabled:opacity-50 sm:static sm:inset-auto sm:min-h-11 sm:shadow-none">{busy ? "Sending…" : "Submit support request"}</button></div>
        </div>
      </form>
      <aside aria-label="Support privacy" className="rounded-[13px] border border-[#e5e9e3] bg-white p-5 sm:p-6">
        <h3 className="font-display text-[21px] font-semibold text-[#202826]">Private by design</h3>
        <p className="mt-5 text-sm leading-6 text-[var(--color-atlas-muted-strong)]">Your order link grants access only to the matching order. Support cases do not cancel orders or initiate refunds.</p>
        <div className="mt-5 space-y-3">{[
          ["Secure lookup", "A valid status token is required."],
          ["Safe sharing", "No full payment or wallet details."],
          ["Case records", "The store owner can review submitted requests."],
        ].map(([label, detail]) => <div key={label} className="rounded-lg bg-[#f0f3ef] p-3"><p className="text-[13px] font-semibold text-[#202826]">{label}</p><p className="mt-2 text-xs text-[var(--color-atlas-muted-strong)]">{detail}</p></div>)}</div>
      </aside>
    </div>}
    <div className="rounded-[13px] border border-[#e5e9e3] bg-white p-5">
      <button type="button" className="text-xs font-semibold text-[#202826] underline" onClick={() => void refreshHistory().catch(() => setError("Case history unavailable. Try later."))}>View this order&apos;s support history</button>
      {error && submitted ? <p role="alert" className="mt-2 text-xs text-[#a34132]">{error}</p> : null}
      {history.length > 0 && <ul className="mt-3 space-y-2" aria-label="Support case history">{history.map((entry) =>
        <li key={entry.caseId} className="rounded-lg bg-[#f7f8f5] p-3 text-xs text-[#53615a]">
          <span className="font-data break-all">{entry.caseId}</span> · {entry.category} · <strong>{entry.status}</strong>
        </li>)}</ul>}
      {history.length === 0 && submitted && <p className="mt-2 text-xs text-[var(--color-atlas-muted-strong)]">Case history is not yet available.</p>}
    </div>
  </section>;
}
