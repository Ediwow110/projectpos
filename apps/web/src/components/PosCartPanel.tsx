import React from "react";
import Link from "next/link";
import Image from "next/image";

import { minorToMajorFixed } from "../lib/money";
import { validProductImageUrl } from "../lib/product-image";
import type { PosCartEntry } from "../lib/pos-sale-model";

type StatusTone = "ok" | "warn" | "info" | "neutral";

interface PosCartPanelProps {
  cart: PosCartEntry[];
  count: number;
  subtotalMinor: number;
  discountMinor: number;
  giftCardLoadMinor?: number;
  due: number;
  selectedRegisterName: string;
  canSell: boolean;
  canPay: boolean;
  offline: boolean;
  saleLocked: boolean;
  heldCount: number;
  effectiveMethod: string;
  status: string;
  statusTone: StatusTone;
  receiptId: string | null;
  reconcileId: string | null;
  reconcileSaleId: string | null;
  methodAvailable: (key: string) => boolean;
  onHold: () => void;
  onOpenHeldSales: () => void;
  onOpenDiscounts: () => void;
  onClearCart: () => void;
  onResetSale: () => void;
  onSetQty: (productId: string, delta: number) => void;
  onAssignCustomer: () => void;
  onOpenPayment: () => void;
  onOpenGiftCardLoad?: () => void;
  onSelectShortcut: (key: string) => void;
}

function money(minor: number): string {
  return minorToMajorFixed(minor);
}

export function PosCartPanel({
  cart,
  count,
  subtotalMinor,
  discountMinor,
  giftCardLoadMinor = 0,
  due,
  selectedRegisterName,
  canSell,
  canPay,
  offline,
  saleLocked,
  heldCount,
  effectiveMethod,
  status,
  statusTone,
  receiptId,
  reconcileId,
  reconcileSaleId,
  methodAvailable,
  onHold,
  onOpenHeldSales,
  onOpenDiscounts,
  onClearCart,
  onResetSale,
  onSetQty,
  onAssignCustomer,
  onOpenPayment,
  onOpenGiftCardLoad = () => undefined,
  onSelectShortcut,
}: PosCartPanelProps) {
  return (
    <aside id="pos-cart" aria-label="Cart" className="min-w-0 lg:max-xl:hidden xl:h-full xl:border-l xl:border-[#e5e9e3] xl:bg-white xl:p-6">
      <div className="relative h-full overflow-hidden bg-white text-[#202826]">
        <h2 aria-label={`Cart (${count})`} className="absolute left-0 top-0 font-display text-[18px] font-semibold">Current sale</h2>
        <button
          type="button"
          onClick={onHold}
          disabled={cart.length === 0 || giftCardLoadMinor > 0}
          className="absolute right-[120px] top-[-4px] h-[34px] w-[68px] rounded-[9px] border border-[#e5e9e3] bg-[#eff2ef] text-[9px] font-semibold text-[#202826] disabled:opacity-40"
        >
          {saleLocked ? "Re-hold" : "Hold"}
        </button>
        <button type="button" onClick={onOpenGiftCardLoad} disabled={offline || saleLocked} className="absolute right-[192px] top-[-4px] h-[34px] rounded-[9px] border border-[#e5e9e3] bg-[#fff3ee] px-2 text-[9px] font-semibold text-[#bd503e] disabled:opacity-40">Load card</button>
        <button
          type="button"
          onClick={onOpenHeldSales}
          className="absolute right-[48px] top-[-4px] h-[34px] w-[68px] rounded-[9px] border border-[#e5e9e3] bg-[#eff2ef] text-[9px] font-semibold text-[#202826] hover:border-[#c9d5cb]"
        >
          Held {heldCount}
        </button>
        <button
          type="button"
          aria-label="Clear sale"
          onClick={onClearCart}
          disabled={cart.length === 0 || saleLocked}
          className="absolute right-0 top-[-4px] h-[34px] w-[40px] rounded-[9px] border border-[#e5e9e3] bg-[#eff2ef] text-[14px] font-semibold text-[#da614c] disabled:opacity-40"
        >
          ⌫
        </button>
        <div aria-hidden className="absolute inset-x-0 top-[46px] border-t border-[#e5e9e3]" />

        {!canSell ? (
          <p role="alert" className="absolute inset-x-0 top-[56px] z-10 rounded-lg bg-red-500/15 px-3 py-2 text-[11px] font-medium text-red-300">
            Your role cannot complete sales.
          </p>
        ) : null}

        <ul className="absolute inset-x-0 top-[56px] overflow-y-auto xl:h-[244px]">
          {cart.length === 0 ? (
            <li className="grid h-full place-items-center text-[11px] text-[#71807a]">Cart is empty. Tap products to add.</li>
          ) : null}
          {cart.map((entry) => {
            const gross = entry.qty * entry.priceMinor;
            const net = Math.max(0, gross - entry.lineDiscountMinor);
            return (
            <li key={entry.productId} className="flex h-[61px] items-center justify-between gap-3 border-b border-[#e5e9e3]">
              {entry.imageUrl && validProductImageUrl(entry.imageUrl) ? (
                <span aria-hidden className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[#eff2ef]">
                  <Image unoptimized src={entry.imageUrl} alt="" fill sizes="40px" className="object-cover" />
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-[#202826]">{entry.name}</p>
                <div className="mt-2 flex items-center gap-2 font-data text-[8px] text-[#71807a]">
                  <span>Qty {entry.qty} × ₱{money(entry.priceMinor)}</span>
                  {entry.lineDiscountMinor > 0 ? <span className="text-[#ff9a82]">−₱{money(entry.lineDiscountMinor)}</span> : null}
                  <button type="button" onClick={() => onSetQty(entry.productId, -1)} disabled={saleLocked} aria-label={"Decrease " + entry.name} className="grid h-5 w-5 place-items-center rounded bg-[#eff2ef] text-[11px] hover:bg-[#e5e9e3] disabled:opacity-35">−</button>
                  <button type="button" onClick={() => onSetQty(entry.productId, 1)} disabled={saleLocked} aria-label={"Increase " + entry.name} className="grid h-5 w-5 place-items-center rounded bg-[#eff2ef] text-[11px] hover:bg-[#e5e9e3] disabled:opacity-35">+</button>
                  <button type="button" onClick={() => onSetQty(entry.productId, -entry.qty)} disabled={saleLocked}
                    aria-label={"Remove " + entry.name} className="text-[9px] font-semibold text-[#da614c] hover:underline disabled:opacity-35">
                    Remove
                  </button>
                </div>
              </div>
              <span className="money shrink-0 text-right text-[11px] font-medium text-[#202826]">
                {entry.lineDiscountMinor > 0 ? <span className="mr-1 text-[8px] text-[#98a49c] line-through">₱{money(gross)}</span> : null}
                ₱{money(net)}
              </span>
            </li>
            );
          })}
        </ul>

        <button
          type="button"
          aria-label="Assign customer to sale"
          onClick={onAssignCustomer}
          disabled={saleLocked}
          className="absolute inset-x-0 top-[322px] h-[38px] rounded-[8px] bg-[#eff2ef] px-3 text-left text-[10px] text-[#53615a] hover:text-[#202826] disabled:opacity-40"
        >
          ○ Add customer / walk-in
        </button>

        <div className="absolute inset-x-0 top-[382px] flex items-center justify-between text-[10px] text-[#71807a]">
          <span>Subtotal ({count} item{count === 1 ? "" : "s"})</span>
          <span className="money font-medium text-[#202826]">₱{money(subtotalMinor)}</span>
        </div>
        <div className="absolute inset-x-0 top-[414px] flex items-center justify-between text-[10px] text-[#71807a]">
          <button
            type="button"
            onClick={onOpenDiscounts}
            disabled={cart.length === 0 || offline || saleLocked}
            className="font-semibold text-[#da614c] hover:text-[#bd503e] disabled:text-[#a6b1aa]"
          >
            Discounts
          </button>
          <span className="money font-medium text-[#da614c]">−₱{money(discountMinor)}</span>
        </div>
        {giftCardLoadMinor > 0 ? <div className="absolute inset-x-0 top-[438px] flex items-center justify-between text-[9px] text-[#ffb7a4]"><span>Gift-card load</span><span className="money font-medium">₱{money(giftCardLoadMinor)}</span></div> : null}
        <div className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[470px]" : "top-[446px]"} flex items-center justify-between text-[9px] text-[#71807a]`}>
          <span>Register</span>
          <span className="font-data max-w-48 truncate text-[8px] text-[#53615a]">{selectedRegisterName}</span>
        </div>
        <div aria-hidden className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[508px]" : "top-[484px]"} border-t border-[#e5e9e3]`} />
        <div className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[523px]" : "top-[499px]"} flex items-end justify-between`}>
          <span className="font-display text-[16px] font-semibold">Total</span>
          <span className="money text-[24px] font-bold">₱{money(due)}</span>
        </div>

        <button
          type="button"
          onClick={onOpenPayment}
          disabled={!canPay}
          className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[576px]" : "top-[552px]"} h-[58px] rounded-xl bg-[#da614c] font-display text-[13px] font-semibold text-white shadow-[0_5px_16px_-6px_rgb(26_18_13/0.07)] hover:bg-[#c85540] disabled:opacity-40`}
        >
          ▣ Pay ₱{money(due)} (F5) →
        </button>

        <div className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[652px]" : "top-[628px]"} grid grid-cols-4 gap-2`}>
          {[
            { key: "cash", label: "Cash (F6)" },
            { key: "card", label: "Card (F7)" },
            { key: "gcash", label: "GCash (F8)" },
            { key: "more", label: "More" },
          ].map((shortcut) => (
            <button
              key={shortcut.key}
              type="button"
              onClick={() => onSelectShortcut(shortcut.key)}
              disabled={
                !canPay ||
                (offline && shortcut.key !== "cash") ||
                (shortcut.key !== "more" && !methodAvailable(shortcut.key))
              }
              className={
                "h-[42px] rounded-[10px] border text-[8px] font-semibold transition disabled:opacity-35 " +
                (shortcut.key === effectiveMethod
                  ? "border-[#da614c] bg-[#fff3ee] text-[#bd503e]"
                  : "border-[#e5e9e3] bg-[#eff2ef] text-[#53615a] hover:border-[#b6c5ba]")
              }
            >
              {shortcut.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onResetSale}
          disabled={cart.length === 0 || reconcileId !== null || saleLocked}
          className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[716px]" : "top-[692px]"} h-12 rounded-[10px] border border-[#e5e9e3] text-[10px] font-semibold text-[#da614c] hover:bg-[#fff3ee] disabled:opacity-35`}
        >
          ⌫ Clear sale
        </button>
        <p className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[784px]" : "top-[760px]"} font-data text-[7px] leading-4 text-[#71807a]`}>
          Totals are server-validated before commit. Unknown payment status blocks blind retries.
        </p>

        {status.includes("SHIFT_NO_OPEN_SHIFT") ? (
          <div className="absolute inset-x-0 top-[322px] z-20 rounded-xl bg-[#302717] px-3 py-3 text-[10px] text-amber-300 shadow-xl">
            <p role="alert">No open shift on this register. <Link href="/shifts" className="font-semibold underline">Open a shift</Link> first.</p>
          </div>
        ) : null}
        {status !== "" && !status.includes("SHIFT_NO_OPEN_SHIFT") ? (
          <div className={`absolute inset-x-0 top-[322px] z-20 max-h-[170px] overflow-auto rounded-xl px-3 py-3 text-[10px] font-medium shadow-xl ${statusTone === "ok" ? "bg-[#173329] text-[#9de0c3]" : statusTone === "warn" ? "bg-[#302717] text-[#ffd58a]" : statusTone === "info" ? "bg-[#18243b] text-[#bfd0ff]" : "bg-[#211f1d] text-white/75"}`}>
            <p role={status.includes("unknown") ? "alert" : "status"}>{status}</p>
            {reconcileSaleId ? (
              <Link href={"/sales/" + reconcileSaleId} className="mt-2 inline-flex font-semibold underline">
                Review unknown payment →
              </Link>
            ) : null}
          </div>
        ) : null}
        {receiptId ? (
          <Link href={"/receipts/" + receiptId} className="absolute inset-x-0 top-[322px] z-30 rounded-xl border border-green-500/40 bg-[#173329] px-4 py-3 text-center text-[11px] font-bold text-green-300 shadow-xl">
            View receipt →
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
