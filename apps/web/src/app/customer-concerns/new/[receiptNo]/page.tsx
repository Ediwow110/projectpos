"use client";

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "../../../../components/AppShell";
import { Panel } from "../../../../components/premium";
import { ApiError, apiFetch } from "../../../../lib/api";
import { formatMoneyMinor } from "../../../../lib/money";

interface ReceiptLookup {
  receiptNo: string;
  saleId: string;
  status: string;
  currency: string;
  totalMinor: number;
  branchId: string | null;
  registerId: string | null;
  createdAt: string;
  completedAt: string | null;
  items: Array<{ id: string; name: string; qty: number; priceMinor: number; lineTotalMinor: number }>;
}

interface Me { role: string; businessName?: string; }
interface CaseResponse { concern: { id: string; status: string }; }

function receiptDate(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function money(minor: number): string {
  return `₱${formatMoneyMinor(minor)}`;
}

function eligibilityMessage(status: string): string | null {
  if (status === "COMPLETED" || status === "PARTIALLY_REFUNDED") return null;
  if (status === "PAYMENT_UNKNOWN") return "Payment status is still unknown. Ask a manager to reconcile it with provider or settlement records before submitting a case. Do not retry payment.";
  if (status === "PENDING_PAYMENT" || status === "PAYMENT_PENDING") return "Payment is still pending. Wait for the provider result or ask a manager to check it before submitting a case.";
  if (status === "REFUND_REQUESTED") return "A refund is already being processed for this sale. Check with a manager before submitting another case.";
  if (status === "REFUNDED") return "This sale has been fully refunded, so no further item concern can be submitted.";
  return "Item concerns can be submitted after a sale is completed and payment is confirmed.";
}

function accessMessage(error: unknown): string {
  if (error instanceof ApiError && ["NOT_FOUND", "FORBIDDEN"].includes(error.code)) {
    return "No matching receipt is available within your current access.";
  }
  if (error instanceof ApiError && error.code === "NETWORK_TIMEOUT") {
    return "Receipt verification took too long. Check the connection and try again.";
  }
  if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
    return "Could not reach the store service. Check the connection and try again.";
  }
  return "Receipt verification failed. Try again in a moment.";
}

export default function NewCustomerConcernPage(): JSX.Element {
  const { receiptNo: routeReceiptNo } = useParams<{ receiptNo: string }>();
  const receiptNo = routeReceiptNo;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submittedHeadingRef = useRef<HTMLHeadingElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const concernAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("DAMAGED");
  const [outcome, setOutcome] = useState("REFUND");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState<CaseResponse["concern"] | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const receipt = useQuery({
    queryKey: ["receipt-lookup", receiptNo],
    queryFn: () => apiFetch<ReceiptLookup>(`/api/v1/receipts/lookup?receiptNo=${encodeURIComponent(receiptNo)}`),
    retry: false,
    enabled: Boolean(receiptNo) && receiptNo.length <= 64,
  });
  const concern = useMutation({
    mutationFn: async (submission: {
      saleId: string;
      items: Array<{ saleItemId: string; qty: number }>;
      reason: string;
      outcome: string;
      note: string;
      idempotencyKey: string;
    }) => {
      const { csrfToken } = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      return apiFetch<CaseResponse>("/api/v1/customer-concerns", {
        csrfToken,
        init: {
          method: "POST",
          headers: { "Idempotency-Key": submission.idempotencyKey },
          body: JSON.stringify({ saleId: submission.saleId, items: submission.items, reason: submission.reason, outcome: submission.outcome, note: submission.note }),
        },
      });
    },
    onSuccess: async (result) => {
      concernAttemptRef.current = null;
      setSubmitted(result.concern);
      setQuantities({});
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["customer-concerns"] });
    },
  });

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => { if (submitted) submittedHeadingRef.current?.focus(); }, [submitted]);
  useEffect(() => { if (concern.isError) submitButtonRef.current?.focus(); }, [concern.isError]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!receipt.data || !canSubmit || concern.isPending) return;
    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([saleItemId, qty]) => ({ saleItemId, qty }));
    const submission = { saleId: receipt.data.saleId, items, reason, outcome, note };
    const fingerprint = JSON.stringify(submission);
    if (concernAttemptRef.current?.fingerprint !== fingerprint) {
      concernAttemptRef.current = { fingerprint, key: crypto.randomUUID() };
    }
    concern.mutate({ ...submission, idempotencyKey: concernAttemptRef.current.key });
  }

  const message = receipt.isError ? accessMessage(receipt.error) : null;
  const eligibility = receipt.data ? eligibilityMessage(receipt.data.status) : null;
  const canSubmit = Boolean(receipt.data && !eligibility && Object.values(quantities).some((qty) => qty > 0));

  return <AppShell businessName={me.data?.businessName} role={me.data?.role ?? "cashier"}>
    <main className="mx-auto w-full max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="font-data text-[10px] font-medium uppercase tracking-[0.16em] text-[#f35d3f]">Customer service / Atlas 2026</p><h1 ref={headingRef} tabIndex={-1} className="font-display mt-1 text-[30px] font-bold leading-tight text-[#17130f] focus:outline-none sm:text-[34px]">Customer complaint intake</h1><p className="mt-2 max-w-3xl text-[13px] leading-5 text-[#73685f]">Verify the original purchase, choose affected quantities, and submit a request for review.</p></div>
        <Link href="/receipts/lookup" className="inline-flex min-h-10 items-center rounded-lg border border-[#dce3dc] bg-white px-4 text-sm font-semibold text-[#202826] hover:border-[#9baa9d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]">Back to receipt lookup</Link>
      </header>

      {receipt.isPending ? <div role="status" aria-live="polite"><Panel className="p-6 text-sm text-[#707b75]">Verifying this receipt in your current access…</Panel></div> : null}
      {message ? <div role="alert"><Panel className="space-y-3 border-[#efc8be] p-6"><p className="text-sm text-[#a34132]">{message}</p><Link href="/receipts/lookup" className="inline-flex min-h-10 items-center rounded-lg border border-[#dce3dc] bg-white px-4 text-sm font-semibold text-[#202826]">Return to receipt lookup</Link></Panel></div> : null}

      {receipt.data ? <>
        <Panel className="!rounded-[12px] border-0 bg-[#e8f4ec] p-5 sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#267552]">Receipt verified</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-base font-semibold text-[#202826]">{receipt.data.receiptNo} <span className="font-sans text-sm font-normal text-[#53615a]">/ {receiptDate(receipt.data.createdAt)} / Total {money(receipt.data.totalMinor)}</span></p>
            <span className="rounded-md bg-white/70 px-2.5 py-1.5 text-[10px] font-semibold uppercase text-[#267552]">{receipt.data.status.replaceAll("_", " ")}</span>
          </div>
          <p className="mt-2 text-xs text-[#53615a]">This is a POS receipt for the recorded sale. It is not a tax invoice or a BIR-compliant document.</p>
        </Panel>

        {submitted ? <Panel className="mx-auto max-w-[800px] px-6 py-10 text-center sm:px-10">
          <span aria-hidden className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#e8f4ec] text-2xl font-semibold text-[#267552]">✓</span>
          <h2 ref={submittedHeadingRef} tabIndex={-1} className="mt-5 font-display text-xl font-semibold text-[#202826] focus:outline-none">Complaint submitted</h2>
          <p role="status" className="mt-2 text-sm leading-6 text-[#53615a]">Your case has been submitted and is {submitted.status === "OWNER_REVIEW" ? "pending OWNER REVIEW" : submitted.status.replaceAll("_", " ").toLowerCase()}. No funds or inventory changed.</p>
          <p className="mt-2 font-data text-xs text-[#707b75]">Case reference {submitted.id}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2"><Link href="/customer-concerns" className="inline-flex min-h-10 items-center rounded-lg bg-[#202826] px-4 text-sm font-semibold text-white hover:bg-[#35423d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]">View case history</Link><Link href="/receipts/lookup" className="inline-flex min-h-10 items-center rounded-lg border border-[#dce3dc] bg-white px-4 text-sm font-semibold text-[#202826]">Look up another receipt</Link></div>
        </Panel> : <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(290px,0.7fr)]">
          <Panel className="!rounded-[12px] !border-[#e4e9e3] p-4 sm:p-5">
            <h2 className="font-display text-lg font-semibold text-[#202826]">Select affected products</h2>
            <p className="mt-2 text-xs leading-5 text-[#748078]">You can report fewer units than the quantity originally purchased. Items already returned or refunded are checked again when you submit.</p>
            <fieldset aria-label="Items and quantities" className="mt-4 space-y-2 border-t border-[#e5e9e3] pt-3">
              {receipt.data.items.map((item) => {
                const qty = quantities[item.id] ?? 0;
                return <div key={item.id} className={`grid gap-3 rounded-lg p-3 sm:grid-cols-[minmax(0,1fr)_112px] sm:items-center ${qty > 0 ? "bg-[#f3f8f4]" : "bg-[#fafbf9]"}`}>
                  <div className="min-w-0"><p className="text-sm font-semibold text-[#202826]">{item.name}</p><p className="mt-1 text-xs text-[#748078]">{item.qty} purchased · {money(item.priceMinor)}/piece</p></div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[#707b75]">Quantity affected<input aria-label={`Concern quantity for ${item.name}`} type="number" min={0} max={item.qty} step={1} value={qty} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: Math.max(0, Math.min(item.qty, Number(event.target.value) || 0)) }))} className="mt-1 min-h-10 w-full rounded-lg border border-[#dce3dc] bg-white px-3 text-sm font-normal text-[#202826] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]" /></label>
                </div>;
              })}
            </fieldset>
          </Panel>

          <Panel className="h-fit !rounded-[12px] !border-[#e4e9e3] p-4 sm:p-5">
            <h2 className="font-display text-base font-semibold text-[#202826]">Issue details</h2>
            {eligibility ? <p role="status" className="mt-4 rounded-lg bg-[#fff7e8] p-3 text-sm leading-5 text-[#775d2c]">{eligibility}</p> : <form className="mt-4 space-y-3" onSubmit={submit}>
              <label className="block text-[11px] font-semibold text-[#707b75]">Reason<select aria-label="Issue reason" value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#dce3dc] bg-[#fafbf9] px-3 text-sm font-normal text-[#202826] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]"><option value="DAMAGED">Damaged / defective</option><option value="DEFECTIVE">Defective</option><option value="WRONG_ITEM">Wrong item</option><option value="MISSING_PARTS">Missing parts</option><option value="QUALITY">Quality concern</option><option value="OTHER">Other</option></select></label>
              <label className="block text-[11px] font-semibold text-[#707b75]">Requested outcome<select aria-label="Requested outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#dce3dc] bg-[#fafbf9] px-3 text-sm font-normal text-[#202826] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]"><option value="REFUND">Refund review</option><option value="EXCHANGE">Return or exchange</option></select></label>
              <label htmlFor="concern-note" className="block text-[11px] font-semibold text-[#707b75]">Customer notes <span className="font-normal">(optional)</span><textarea id="concern-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Describe the reported issue" className="mt-1 w-full resize-y rounded-lg border border-[#dce3dc] bg-[#fafbf9] p-3 text-sm font-normal text-[#202826] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]" /></label>
              {concern.isError ? <p role="alert" className="text-sm text-[#a34132]">{concern.error instanceof ApiError && concern.error.code === "RETURN_EXCEEDS_RETURNABLE" ? "Some quantity is already in another case or has been refunded. Refresh the receipt and try again." : concern.error instanceof ApiError && concern.error.code === "SALE_NOT_RETURNABLE" ? "This sale is not eligible for an item concern until payment is confirmed. No refund or stock change was made." : "The case could not be submitted. No refund or stock change was made."}</p> : null}
              <p className="text-[11px] leading-5 text-[#748078]">Submitting creates a request for review. It does not issue a refund or change stock.</p>
              <button ref={submitButtonRef} type="submit" disabled={concern.isPending || !canSubmit} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#202826] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#35423d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552] disabled:cursor-not-allowed disabled:opacity-50">{concern.isPending ? "Submitting…" : "Submit for review"}</button>
            </form>}
          </Panel>
        </div>}
      </> : null}
    </main>
  </AppShell>;
}
