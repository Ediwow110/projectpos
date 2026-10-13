"use client";

import type { JSX } from "react";
import { useState, useRef } from "react";
import { ApiError, apiFetch } from "../lib/api";

interface GuestCase { caseId: string; category: string; status: string; createdAt: string }

export function GuestSupportForm({ statusToken }: { statusToken: string }): JSX.Element {
  const [category, setCategory] = useState<"ORDER" | "PAYMENT" | "FULFILLMENT" | "OTHER">("ORDER");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [history, setHistory] = useState<GuestCase[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef<string | null>(null);

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

  return <section aria-label="Customer support" className="rounded-2xl border border-[#eee4db] bg-white p-5 sm:p-7">
    <h2 className="font-display text-xl font-semibold text-[#2a241f]">Need help with this order?</h2>
    <p className="mt-2 text-sm leading-6 text-[#73685f]">Send a request to the store. This does not cancel your order or initiate a refund.</p>
    {submitted ? <div role="status" className="mt-4 rounded-xl border border-[#cce1d1] bg-[#f4faf5] p-4 text-sm">
      <p className="font-semibold text-[#276746]">Support request received</p>
      <p className="mt-1 break-all">Reference: <span className="font-data">{submitted}</span></p>
      <p className="mt-1 text-[#496357]">The store can review this case. Keep your order email for follow-up.</p>
      <button type="button" className="mt-3 text-xs font-semibold underline" onClick={() => setSubmitted(null)}>Submit another issue</button>
    </div> : <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
      <label className="block text-xs font-semibold text-[#655b53]">What do you need help with?
        <select className="field mt-1.5" value={category} onChange={(event) => { setCategory(event.target.value as typeof category); idempotencyKey.current = null; }}>
          <option value="ORDER">Order details</option><option value="PAYMENT">Payment question</option><option value="FULFILLMENT">Pickup or delivery</option><option value="OTHER">Other</option>
        </select>
      </label>
      <label className="block text-xs font-semibold text-[#655b53]">Describe the issue
        <textarea className="field mt-1.5 min-h-28" required minLength={10} maxLength={1000}
          placeholder="Tell the store what happened and how they can help" value={description}
          onChange={(event) => { setDescription(event.target.value); idempotencyKey.current = null; }} />
      </label>
      {error && <p role="alert" className="text-sm text-[#b14336]">{error}</p>}
      <button type="submit" disabled={busy || description.trim().length < 10} className="min-h-11 rounded-lg bg-[#f35d3f] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Sending…" : "Send support request"}</button>
    </form>}
    <div className="mt-5 border-t border-[#eee4db] pt-4">
      <button type="button" className="text-xs font-semibold text-[#2a241f] underline" onClick={() => void refreshHistory().catch(() => setError("Case history unavailable. Try later."))}>View this order's support history</button>
      {history.length > 0 && <ul className="mt-3 space-y-2" aria-label="Support case history">{history.map((entry) =>
        <li key={entry.caseId} className="rounded-lg bg-[#fcf8f3] p-3 text-xs text-[#655b53]">
          <span className="font-data break-all">{entry.caseId}</span> · {entry.category} · <strong>{entry.status}</strong>
        </li>)}</ul>}
      {history.length === 0 && submitted && <p className="mt-2 text-xs text-[#73685f]">Case history is not yet available.</p>}
    </div>
  </section>;
}
