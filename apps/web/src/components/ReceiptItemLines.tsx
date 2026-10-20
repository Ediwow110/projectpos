import React from "react";
import { formatMoneyMinor } from "../lib/money";

interface ReceiptLine {
  name: string;
  qty: number;
  priceMinor: number;
  lineTotalMinor: number;
}

/** Display prices recorded on the receipt; never recompute authoritative discounted line totals. */
export function ReceiptItemLines({ items }: { items: ReceiptLine[] }) {
  const totalPieces = items.reduce((sum, item) => sum + item.qty, 0);
  return (
    <section aria-label="Purchased items">
      <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_48px_100px_116px] gap-3 border-b border-[#e4e9e3] pb-3 font-data text-[10px] font-semibold uppercase tracking-[0.08em] text-[#707b75] sm:grid print:hidden">
        <span>PRODUCT</span>
        <span>QTY</span>
        <span>UNIT</span>
        <span className="text-right">LINE TOTAL</span>
      </div>
      <ul className="divide-y divide-[#e4e9e3]">
        {items.map((item, index) => (
          <li key={`${index}-${item.name}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_48px_100px_116px] print:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="break-words font-medium text-[#202826]">{item.name}</p>
              <p className="mt-1 font-data text-[10px] text-[#707b75] sm:hidden print:block">{item.qty} × ₱{formatMoneyMinor(item.priceMinor)}</p>
            </div>
            <span className="hidden font-data text-[#202826] sm:block print:hidden">{item.qty}</span>
            <span className="hidden font-data text-[#202826] sm:block print:hidden">₱{formatMoneyMinor(item.priceMinor)}</span>
            <strong className="font-data text-right font-semibold text-[#202826]">₱{formatMoneyMinor(item.lineTotalMinor)}</strong>
            <span className="sr-only">{item.qty} × ₱{formatMoneyMinor(item.priceMinor)}; recorded line total ₱{formatMoneyMinor(item.lineTotalMinor)}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-between border-t border-[#e4e9e3] pt-4 text-xs text-[#707b75]">
        <span>Total pieces</span>
        <strong className="font-data text-[#202826]">{totalPieces}</strong>
      </div>
    </section>
  );
}
