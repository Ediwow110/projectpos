"use client";

import type { FormEvent, JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { PageHeader, Panel } from "../../../components/premium";
import { PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { formatMoneyMinor } from "../../../lib/money";

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

interface Me {
  role: string;
  businessName?: string;
}

function receiptDate(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function money(minor: number): string {
  return `₱${formatMoneyMinor(minor)}`;
}

function statusTone(status: string): "ok" | "warn" | "bad" | "info" {
  if (status === "COMPLETED" || status === "PARTIALLY_REFUNDED") return "ok";
  if (status === "REFUND_REQUESTED" || status === "PENDING_PAYMENT" || status === "PAYMENT_PENDING" || status === "PAYMENT_UNKNOWN") return "warn";
  if (status === "VOIDED" || status === "REFUNDED" || status === "PAYMENT_FAILED") return "bad";
  return "info";
}

function concernEligibilityMessage(status: string): string | null {
  if (status === "COMPLETED" || status === "PARTIALLY_REFUNDED") return null;
  if (status === "PAYMENT_UNKNOWN") return "Payment status is still unknown. Ask a manager to reconcile it with provider or settlement records before submitting a case. Do not retry payment.";
  if (status === "PENDING_PAYMENT" || status === "PAYMENT_PENDING") return "Payment is still pending. Wait for the provider result or ask a manager to check it before submitting a case.";
  if (status === "REFUND_REQUESTED") return "A refund is already being processed for this sale. Check with a manager before submitting another case.";
  if (status === "REFUNDED") return "This sale has been fully refunded, so no further item concern can be submitted.";
  return "Item concerns can be submitted after a sale is completed and payment is confirmed.";
}

function lookupError(error: unknown): { kind: "missing" | "error"; message: string } {
  if (error instanceof ApiError && ["NOT_FOUND", "FORBIDDEN"].includes(error.code)) {
    return { kind: "missing", message: "No matching receipt is available within your current access." };
  }
  if (error instanceof ApiError && error.code === "NETWORK_TIMEOUT") {
    return { kind: "error", message: "The search took too long. Check the connection and try again." };
  }
  if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
    return { kind: "error", message: "Could not reach the store service. Check the connection and try again." };
  }
  return { kind: "error", message: "Receipt lookup failed. Try again in a moment." };
}

export default function ReceiptLookupPage(): JSX.Element {
  const [receiptNo, setReceiptNo] = useState("");
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const lookup = useMutation({
    mutationFn: (exactReceiptNo: string) => apiFetch<ReceiptLookup>(
      `/api/v1/receipts/lookup?receiptNo=${encodeURIComponent(exactReceiptNo)}`,
    ),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const exactReceiptNo = receiptNo.trim();
    if (!exactReceiptNo || exactReceiptNo.length > 64 || lookup.isPending) return;
    lookup.mutate(exactReceiptNo);
  }

  const failure = lookup.isError ? lookupError(lookup.error) : null;
  const role = meQuery.data?.role ?? "cashier";

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role} atlasCashier>
      <main className={role === "cashier" ? "mx-auto w-full max-w-none space-y-6 px-4 pb-10 pt-8 sm:px-8 lg:px-[38px]" : "mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6"}>
        {role === "cashier" ? <header className="space-y-2">
          <p className="font-data text-[11px] tracking-[0.06em] text-[#748078]">SALES / RECEIPT LOOKUP</p>
          <h1 className="font-display text-[29px] font-semibold tracking-tight text-[#202826]">Find a receipt</h1>
          <p className="text-[13px] leading-5 text-[#748078]">Search a receipt to verify a purchase before handling a customer concern.</p>
        </header> : <PageHeader
          eyebrow="Sales / Receipt lookup"
          title="Find a receipt"
          description="Search a receipt to verify a purchase before handling a customer concern."
        />}

        <Panel className="!rounded-[14px] !border-[#e4e9e3] p-5 sm:p-6">
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <label htmlFor="receipt-number" className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#707b75]">
                Receipt number
              </label>
              <input
                id="receipt-number"
                name="receiptNo"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                value={receiptNo}
                onChange={(event) => { setReceiptNo(event.target.value); lookup.reset(); }}
                placeholder="e.g. 2026-000008"
                aria-describedby="receipt-lookup-help"
                className="mt-2 min-h-12 w-full rounded-[9px] border border-[#dce3dc] bg-white px-3.5 font-data text-sm text-[#202826] placeholder:font-sans placeholder:text-[#829087] focus:border-[#267552] focus:outline-none focus:ring-2 focus:ring-[#267552]/15"
              />
            </div>
            <PrimaryButton
              type="submit"
              disabled={!receiptNo.trim() || receiptNo.trim().length > 64 || lookup.isPending}
              className="min-h-12 min-w-40 rounded-[8px] bg-[#202826] shadow-none hover:bg-[#35423d] active:bg-[#35423d]"
            >
              {lookup.isPending ? <><span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" />Searching…</> : "Search"}
            </PrimaryButton>
            <p id="receipt-lookup-help" className="text-[11px] leading-5 text-[#707b75] md:col-span-2">
              Press Enter or select Search. Results stay hidden until you submit an exact receipt number.
            </p>
          </form>
        </Panel>

        <section aria-label="Receipt lookup result" aria-live="polite" aria-busy={lookup.isPending}>
          {lookup.isPending ? (
            <Panel className="grid min-h-[280px] place-items-center !rounded-[14px] !border-[#e4e9e3] p-8 text-center">
              <div><span aria-hidden className="mx-auto grid h-14 w-14 animate-pulse place-items-center rounded-[18px] bg-[#eff2ed] text-2xl text-[#267552] motion-reduce:animate-none">⌕</span><p className="mt-5 font-display text-lg font-semibold text-[#202826]">Looking for receipt {receiptNo.trim()}</p><p className="mt-2 text-sm text-[#707b75]">Checking within your authorized business and branch.</p></div>
            </Panel>
          ) : lookup.data ? (
            <Panel className="overflow-hidden !rounded-[14px] !border-[#e4e9e3] p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-md bg-[#e9f4ec] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#267552]">Match found</span>
                <h2 className="font-display min-w-0 flex-1 text-lg font-semibold text-[#202826] sm:text-xl">Receipt {lookup.data.receiptNo}</h2>
                <StatusPill tone={statusTone(lookup.data.status)}>{lookup.data.status.replaceAll("_", " ")}</StatusPill>
              </div>
              <p className="mt-3 text-[12px] text-[#707b75]">{receiptDate(lookup.data.createdAt)}</p>
              <div className="my-4 border-t border-[#e4e9e3]" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-separate border-spacing-y-1 text-left text-[12px]">
                  <thead className="font-data text-[9px] font-medium uppercase tracking-[0.08em] text-[#707b75]">
                    <tr><th scope="col" className="px-2 py-2">Product</th><th scope="col" className="px-2 py-2">Qty</th><th scope="col" className="px-2 py-2">Unit price</th><th scope="col" className="px-2 py-2 text-right">Line total</th></tr>
                  </thead>
                  <tbody>
                    {lookup.data.items.map((item, index) => (
                      <tr key={item.id} className={index % 2 === 1 ? "bg-[#fafbf9]" : "bg-white"}>
                        <td className="rounded-l-lg px-2 py-3 font-medium text-[#202826]">{item.name}</td>
                        <td className="px-2 py-3 font-data text-[#202826]">{item.qty}</td>
                        <td className="px-2 py-3 font-data text-[#202826]">{money(item.priceMinor)}</td>
                        <td className="rounded-r-lg px-2 py-3 text-right font-data font-medium text-[#202826]">{money(item.lineTotalMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#e4e9e3] pt-3">
                <p className="text-sm font-semibold text-[#202826]">{lookup.data.items.reduce((sum, item) => sum + item.qty, 0)} pieces · Receipt total</p>
                <p className="font-display text-xl font-bold text-[#202826]">{money(lookup.data.totalMinor)}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/receipts/${encodeURIComponent(lookup.data.saleId)}`} className="inline-flex min-h-10 items-center justify-center rounded-[8px] border border-[#dce3dc] bg-white px-4 text-[12px] font-semibold text-[#202826] transition-colors hover:border-[#9baa9d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]">View receipt</Link>
                <Link href={`/sales/${encodeURIComponent(lookup.data.saleId)}`} className="inline-flex min-h-10 items-center justify-center rounded-[8px] bg-[#202826] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[#35423d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]">View sale actions</Link>
                {concernEligibilityMessage(lookup.data.status) ? <p role="status" className="max-w-xl self-center text-xs leading-5 text-[#707b75]">{concernEligibilityMessage(lookup.data.status)}</p> : <Link href={`/customer-concerns/new/${encodeURIComponent(lookup.data.receiptNo)}`} className="inline-flex min-h-10 items-center justify-center rounded-[8px] border border-[#dce3dc] bg-white px-4 text-[12px] font-semibold text-[#202826] transition-colors hover:border-[#9baa9d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552]">Report an item concern</Link>}
              </div>
              <p className="mt-3 text-[10px] leading-4 text-[#707b75]">This is a POS receipt for the recorded sale. It is not a tax invoice or a BIR-compliant document.</p>
            </Panel>
          ) : failure ? (
            <Panel className={`flex min-h-[220px] flex-col items-center justify-center !rounded-[14px] !border p-8 text-center ${failure.kind === "missing" ? "!border-[#e4e9e3]" : "!border-[#efc8be]"}`}>
              <span aria-hidden className={`grid h-14 w-14 place-items-center rounded-[18px] text-2xl ${failure.kind === "missing" ? "bg-[#eff2ed] text-[#707b75]" : "bg-[#fff0eb] text-[#b84b38]"}`}>{failure.kind === "missing" ? "⌕" : "!"}</span>
              <h2 className="font-display mt-4 text-lg font-semibold text-[#202826]">{failure.kind === "missing" ? "Receipt not found" : "Search could not be completed"}</h2>
              <p role={failure.kind === "error" ? "alert" : "status"} className="mt-2 max-w-lg text-sm leading-6 text-[#707b75]">{failure.message}</p>
            </Panel>
          ) : (
            <Panel className="grid min-h-[300px] place-items-center !rounded-[14px] !border-[#e4e9e3] p-8 text-center sm:min-h-[340px]">
              <div>
                <span aria-hidden className="mx-auto grid h-[76px] w-[84px] place-items-center rounded-[20px] bg-[#eff2ed] text-[42px] leading-none text-[#267552]">⌕</span>
                <h2 className="font-display mt-5 text-lg font-semibold text-[#202826] sm:text-xl">{receiptNo.trim() ? 'Receipt number ready to search' : 'Enter a receipt number to get started'}</h2>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#707b75]">No receipt details or product lines appear until an exact number is searched.</p>
                <span className="mt-6 inline-flex rounded-md bg-[#e7f0f6] px-3 py-2 text-[10px] font-medium text-[#496b81]">Customer concern lookup · authorized access only</span>
              </div>
            </Panel>
          )}
        </section>
      </main>
    </AppShell>
  );
}
