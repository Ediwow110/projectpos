"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { PageHeader, Panel } from "../../../components/premium";
import { PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";

interface Me {
  role: string;
  businessName?: string;
}

interface ReceiptItem {
  name: string;
  qty: number;
  priceMinor: number;
  lineTotalMinor: number;
}

interface ReceiptPayment {
  method: string;
  amountMinor: number;
  status: string;
}

interface Receipt {
  receiptNo: string;
  saleId: string;
  currency: string;
  status: string;
  customerName: string | null;
  items: ReceiptItem[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  payments: ReceiptPayment[];
}

function money(minor: number): string {
  return (minor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function methodLabel(method: string): string {
  return method.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function ReceiptPage({ params }: { params: Promise<{ saleId: string }> }): JSX.Element {
  const { saleId } = use(params);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const receiptQuery = useQuery({ queryKey: ["receipt", saleId], queryFn: () => apiFetch<Receipt>(`/api/v1/receipts/${saleId}`), retry: false });

  if (receiptQuery.isError || (!receiptQuery.isLoading && !receiptQuery.data)) {
    return (
      <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
        <main className="mx-auto max-w-[1240px] p-6">
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-6">
            <p role="alert" className="text-sm font-medium text-[#c43e3e]">{receiptQuery.error instanceof ApiError ? `${receiptQuery.error.code}: ${receiptQuery.error.message}` : "Receipt not found."}</p>
            <Link href="/sales" className="mt-3 inline-block text-sm font-semibold text-[#e44e34]">← Back to sales</Link>
          </Panel>
        </main>
      </AppShell>
    );
  }

  const receipt = receiptQuery.data;

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <div className="print:hidden">
          <PageHeader
            eyebrow="Sales / Receipt"
            title={receipt ? `Receipt ${receipt.receiptNo}` : "Receipt"}
            description="Print the recorded receipt without changing the underlying sale."
            actions={
              <>
                <Link href={`/sales/${saleId}`} className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Sale detail</Link>
                <PrimaryButton type="button" onClick={() => window.print()}>Print receipt</PrimaryButton>
              </>
            }
          />
        </div>

        {receipt ? (
          <article data-ui="printable-receipt" aria-label="Receipt" className="mx-auto w-full max-w-[430px] overflow-hidden rounded-[18px] border border-[#eadfd6] bg-white shadow-[0_18px_48px_-20px_rgb(22_18_14/0.22)] print:max-w-[80mm] print:rounded-none print:border-0 print:shadow-none">
            <header className="border-b border-dashed border-[#d8ccc2] px-6 py-6 text-center">
              <p className="font-display text-xl font-bold tracking-[-0.03em] text-[#17130f]">NEXPOS</p>
              <p className="font-data mt-1 text-[8px] uppercase tracking-[0.16em] text-[#9a8d83]">Retail operations receipt</p>
              <p className="font-data mt-4 text-sm font-semibold text-[#2a241f]">{receipt.receiptNo}</p>
              <div className="mt-3"><StatusPill tone={receipt.status === "COMPLETED" ? "ok" : "info"}>{receipt.status}</StatusPill></div>
              {receipt.customerName ? <p className="mt-3 text-[11px] text-[#73685f]">Customer · {receipt.customerName}</p> : null}
            </header>

            <div className="px-6 py-5">
              <div className="space-y-3">
                {receipt.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 text-[12px]">
                    <div><p className="font-semibold text-[#2a241f]">{item.name}</p><p className="font-data mt-1 text-[10px] text-[#9a8d83]">{item.qty} × ₱{money(item.priceMinor)}</p></div>
                    <p className="font-data font-semibold text-[#2a241f]">₱{money(item.lineTotalMinor)}</p>
                  </div>
                ))}
              </div>

              <div aria-hidden className="my-5 border-t border-dashed border-[#d8ccc2]" />

              <dl className="space-y-2 text-[11px]">
                {[
                  ["Subtotal", receipt.subtotalMinor],
                  ["Discount", -receipt.discountMinor],
                  ["Tax", receipt.taxMinor],
                ].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between"><dt className="text-[#73685f]">{label}</dt><dd className="font-data text-[#2a241f]">{Number(value) < 0 ? "−" : ""}₱{money(Math.abs(Number(value)))}</dd></div>)}
                <div className="flex items-center justify-between border-t border-[#eee4db] pt-3 text-sm"><dt className="font-display font-bold text-[#17130f]">Total</dt><dd className="font-data font-bold text-[#17130f]">₱{money(receipt.totalMinor)}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-[#73685f]">Paid</dt><dd className="font-data text-[#2a241f]">₱{money(receipt.paidMinor)}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-[#73685f]">Change</dt><dd className="font-data text-[#2a241f]">₱{money(receipt.changeMinor)}</dd></div>
              </dl>

              <div aria-hidden className="my-5 border-t border-dashed border-[#d8ccc2]" />

              <div className="space-y-2">
                <p className="font-data text-[8px] font-semibold uppercase tracking-[0.14em] text-[#9a8d83]">Payments</p>
                {receipt.payments.map((payment, index) => <div key={`${payment.method}-${index}`} className="flex items-center justify-between text-[11px]"><span className="text-[#73685f]">{methodLabel(payment.method)} · {payment.status}</span><span className="font-data font-semibold text-[#2a241f]">₱{money(payment.amountMinor)}</span></div>)}
              </div>
            </div>

            <footer className="border-t border-dashed border-[#d8ccc2] px-6 py-5 text-center"><p className="text-[10px] font-semibold text-[#2a241f]">Thank you.</p><p className="font-data mt-2 text-[8px] text-[#9a8d83]">Sale {receipt.saleId.slice(0, 8)} · {receipt.currency}</p></footer>
          </article>
        ) : <Panel className="p-6 text-sm text-[#73685f]">Loading receipt…</Panel>}
      </main>
      <style>{`@media print { [data-ui="shell-header"], [data-ui="shell-mobile-nav"], [data-ui="shell-sidebar"], [data-ui="shell-footer"] { display: none !important; } [data-ui="shell-body"] { display: block !important; max-width: none !important; } [data-ui="shell-main"] { width: 100% !important; } body { background: #fff !important; } main { padding: 0 !important; } }`}</style>
    </AppShell>
  );
}
