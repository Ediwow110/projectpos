import React from "react";
import Link from "next/link";

import { minorToMajorFixed } from "../lib/money";
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
    <aside id="pos-cart" aria-label="Cart" className="min-w-0 lg:max-xl:hidden xl:h-full xl:bg-[#171614] xl:p-5">
      <div className="relative h-full overflow-hidden bg-[#171614]">
        <h2 aria-label={`Cart (${count})`} className="absolute left-0 top-0 font-display text-[18px] font-semibold">Current sale</h2>
        <button
          type="button"
          onClick={onHold}
          disabled={cart.length === 0 || giftCardLoadMinor > 0}
          className="absolute right-[120px] top-[-4px] h-[34px] w-[68px] rounded-[9px] border border-[#3b3732] bg-[#252422] text-[9px] font-semibold text-[#d5cdc6] disabled:opacity-40"
        >
          {saleLocked ? "Re-hold" : "Hold"}
        </button>
        <button type="button" onClick={onOpenGiftCardLoad} disabled={offline || saleLocked} className="absolute right-[192px] top-[-4px] h-[34px] rounded-[9px] border border-[#6b493d] bg-[#2b211d] px-2 text-[9px] font-semibold text-[#ffb7a4] disabled:opacity-40">Load card</button>
        <button
          type="button"
          onClick={onOpenHeldSales}
          className="absolute right-[48px] top-[-4px] h-[34px] w-[68px] rounded-[9px] border border-[#3b3732] bg-[#252422] text-[9px] font-semibold text-[#d5cdc6] hover:border-[#5a524b]"
        >
          Held {heldCount}
        </button>
        <button
          type="button"
          aria-label="Clear sale"
          onClick={onClearCart}
          disabled={cart.length === 0 || saleLocked}
          className="absolute right-0 top-[-4px] h-[34px] w-[40px] rounded-[9px] border border-[#3b3732] bg-[#252422] text-[14px] font-semibold text-[#ff765a] disabled:opacity-40"
        >
          ⌫
        </button>
        <div aria-hidden className="absolute inset-x-0 top-[46px] border-t border-[#393530]" />

        {!canSell ? (
          <p role="alert" className="absolute inset-x-0 top-[56px] z-10 rounded-lg bg-red-500/15 px-3 py-2 text-[11px] font-medium text-red-300">
            Your role cannot complete sales.
          </p>
        ) : null}

        <ul className="absolute inset-x-0 top-[56px] overflow-y-auto xl:h-[244px]">
          {cart.length === 0 ? (
            <li className="grid h-full place-items-center text-[11px] text-white/40">Cart is empty. Tap products to add.</li>
          ) : null}
          {cart.map((entry) => {
            const gross = entry.qty * entry.priceMinor;
            const net = Math.max(0, gross - entry.lineDiscountMinor);
            return (
            <li key={entry.productId} className="flex h-[61px] items-center justify-between gap-3 border-b border-[#393530]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[9px] font-semibold text-white">{entry.name}</p>
                <div className="mt-2 flex items-center gap-2 font-data text-[8px] text-[#aaa096]">
                  <span>Qty {entry.qty}</span>
                  {entry.lineDiscountMinor > 0 ? <span className="text-[#ff9a82]">−₱{money(entry.lineDiscountMinor)}</span> : null}
                  <button type="button" onClick={() => onSetQty(entry.productId, -1)} disabled={saleLocked} aria-label={"Decrease " + entry.name} className="grid h-5 w-5 place-items-center rounded bg-white/[0.06] text-[11px] hover:bg-white/10 disabled:opacity-35">−</button>
                  <button type="button" onClick={() => onSetQty(entry.productId, 1)} disabled={saleLocked} aria-label={"Increase " + entry.name} className="grid h-5 w-5 place-items-center rounded bg-white/[0.06] text-[11px] hover:bg-white/10 disabled:opacity-35">+</button>
                </div>
              </div>
              <span className="money shrink-0 text-right text-[9px] font-medium text-white">
                {entry.lineDiscountMinor > 0 ? <span className="mr-1 text-[8px] text-white/35 line-through">₱{money(gross)}</span> : null}
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
          className="absolute inset-x-0 top-[322px] h-[38px] rounded-[8px] bg-[#252422] px-3 text-left text-[9px] text-[#aaa096] hover:text-white disabled:opacity-40"
        >
          ○ Add customer / walk-in
        </button>

        <div className="absolute inset-x-0 top-[382px] flex items-center justify-between text-[9px] text-[#afa59d]">
          <span>Subtotal ({count} item{count === 1 ? "" : "s"})</span>
          <span className="money font-medium text-white">₱{money(subtotalMinor)}</span>
        </div>
        <div className="absolute inset-x-0 top-[414px] flex items-center justify-between text-[9px] text-[#afa59d]">
          <button
            type="button"
            onClick={onOpenDiscounts}
            disabled={cart.length === 0 || offline || saleLocked}
            className="font-semibold text-[#ff9a82] hover:text-[#ffb5a3] disabled:text-[#6f625a]"
          >
            Discounts
          </button>
          <span className="money font-medium text-[#ff9a82]">−₱{money(discountMinor)}</span>
        </div>
        {giftCardLoadMinor > 0 ? <div className="absolute inset-x-0 top-[438px] flex items-center justify-between text-[9px] text-[#ffb7a4]"><span>Gift-card load</span><span className="money font-medium">₱{money(giftCardLoadMinor)}</span></div> : null}
        <div className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[470px]" : "top-[446px]"} flex items-center justify-between text-[9px] text-[#afa59d]`}>
          <span>Register</span>
          <span className="font-data max-w-48 truncate text-[8px] text-white/75">{selectedRegisterName}</span>
        </div>
        <div aria-hidden className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[508px]" : "top-[484px]"} border-t border-[#393530]`} />
        <div className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[523px]" : "top-[499px]"} flex items-end justify-between`}>
          <span className="font-display text-[16px] font-semibold">Total</span>
          <span className="money text-[24px] font-bold">₱{money(due)}</span>
        </div>

        <button
          type="button"
          onClick={onOpenPayment}
          disabled={!canPay}
          className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[576px]" : "top-[552px]"} h-[58px] rounded-xl bg-[#f35d3f] font-display text-[13px] font-semibold text-white shadow-[0_5px_16px_-6px_rgb(26_18_13/0.07)] hover:bg-[#d94a30] disabled:opacity-40`}
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
                  ? "border-[#ff765a] bg-[#302522] text-[#ffb7a4]"
                  : "border-[#3b3732] bg-[#252422] text-[#d5cdc6] hover:border-[#5a524b]")
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
          className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[716px]" : "top-[692px]"} h-12 rounded-[10px] border border-[#d94a30] text-[10px] font-semibold text-[#ff765a] hover:bg-[#2b1d19] disabled:opacity-35`}
        >
          ⌫ Clear sale
        </button>
        <p className={`absolute inset-x-0 ${giftCardLoadMinor > 0 ? "top-[784px]" : "top-[760px]"} font-data text-[7px] leading-4 text-[#756b63]`}>
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
