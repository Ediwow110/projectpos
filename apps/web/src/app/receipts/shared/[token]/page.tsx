"use client";

import type { JSX } from "react";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";

import { NexposLogo } from "../../../../components/brand/NexposLogo";
import { apiBase } from "../../../../lib/api";

interface SharedReceipt {
  receiptNo: string;
  status: string;
  items: Array<{ name: string; qty: number; lineTotalMinor: number }>;
  giftCardLoads: Array<{ amountMinor: number; kind: "NEW" | "RELOAD"; maskedCode: string | null }>;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  tenders: Array<{ method: string; amountMinor: number }>;
}

function money(minor: number): string {
  return (minor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SharedReceiptPage({ params }: { params: Promise<{ token: string }> }): JSX.Element {
  const { token } = use(params);
  const query = useQuery({
    queryKey: ["shared-receipt", token],
    queryFn: async () => {
      const response = await fetch(`${apiBase()}/api/v1/receipts/shared/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Shared receipt unavailable");
      return response.json() as Promise<SharedReceipt>;
    },
    retry: false,
  });

  return (
    <main className="min-h-screen bg-[#f3eee8] px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-[430px]">
        <div className="mb-5 text-center">
          <NexposLogo variant="light" size="md" className="mx-auto" />
          <p className="font-data mt-1 text-[9px] uppercase tracking-[0.16em] text-[#9a8d83]">Secure shared receipt</p>
        </div>
        {query.isLoading ? <div className="rounded-2xl border border-[#eadfd6] bg-white p-6 text-center text-sm text-[#73685f]">Loading receipt…</div> : null}
        {query.isError ? <div role="alert" className="rounded-2xl border border-[#efb9b9] bg-[#fff0f0] p-6 text-center text-sm font-medium text-[#c43e3e]">This receipt link is invalid or has expired.</div> : null}
        {query.data ? (
          <article aria-label="Shared receipt" className="overflow-hidden rounded-[18px] border border-[#eadfd6] bg-white shadow-[0_18px_48px_-20px_rgb(22_18_14/0.22)]">
            <header className="border-b border-dashed border-[#d8ccc2] px-6 py-6 text-center">
              <p className="font-data text-sm font-semibold text-[#2a241f]">{query.data.receiptNo}</p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#31744c]">{query.data.status}</p>
            </header>
            <div className="space-y-5 px-6 py-5">
              <div className="space-y-3">
                {query.data.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex items-start justify-between gap-4 text-[12px]">
                    <div><p className="font-semibold text-[#2a241f]">{item.name}</p><p className="font-data mt-1 text-[10px] text-[#9a8d83]">Qty {item.qty}</p></div>
                    <p className="font-data font-semibold text-[#2a241f]">₱{money(item.lineTotalMinor)}</p>
                  </div>
                ))}
                {query.data.giftCardLoads.map((load, index) => (
                  <div key={`gift-card-load-${index}`} className="flex items-start justify-between gap-4 text-[12px]">
                    <div><p className="font-semibold text-[#2a241f]">{load.kind === "NEW" ? "Gift card load" : "Gift card reload"}</p><p className="font-data mt-1 text-[10px] text-[#9a8d83]">{load.maskedCode ?? "Stored-value load"}</p></div>
                    <p className="font-data font-semibold text-[#2a241f]">₱{money(load.amountMinor)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-[#d8ccc2] pt-4 text-[11px]">
                <div className="flex justify-between"><span className="text-[#73685f]">Subtotal</span><span className="font-data">₱{money(query.data.subtotalMinor)}</span></div>
                <div className="mt-2 flex justify-between"><span className="text-[#73685f]">Discount</span><span className="font-data">−₱{money(query.data.discountMinor)}</span></div>
                <div className="mt-2 flex justify-between"><span className="text-[#73685f]">Tax</span><span className="font-data">₱{money(query.data.taxMinor)}</span></div>
                <div className="mt-3 flex justify-between border-t border-[#eee4db] pt-3 text-sm font-bold"><span>Total</span><span className="font-data">₱{money(query.data.totalMinor)}</span></div>
              </div>
              <div className="border-t border-dashed border-[#d8ccc2] pt-4">
                <p className="font-data text-[8px] font-semibold uppercase tracking-[0.14em] text-[#9a8d83]">Payments</p>
                {query.data.tenders.map((tender, index) => (
                  <div key={`${tender.method}-${index}`} className="mt-2 flex justify-between text-[11px]"><span className="text-[#73685f]">{tender.method.toUpperCase()}</span><span className="font-data font-semibold">₱{money(tender.amountMinor)}</span></div>
                ))}
              </div>
            </div>
            <footer className="border-t border-dashed border-[#d8ccc2] px-6 py-5 text-center text-[9px] leading-4 text-[#9a8d83]">This secure receipt link expires automatically.</footer>
          </article>
        ) : null}
      </div>
    </main>
  );
}
