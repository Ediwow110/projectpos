import React from "react";
import Link from "next/link";

import { minorToMajorFixed } from "../lib/money";
import type { PosCartEntry } from "../lib/pos-sale-model";
import { productInitials, productTileClass } from "../lib/pos-view";

type StatusTone = "ok" | "warn" | "info" | "neutral";

interface PosResponsiveCartProps {
  cart: PosCartEntry[];
  count: number;
  due: number;
  discountMinor: number;
  giftCardLoadMinor?: number;
  canPay: boolean;
  saleLocked: boolean;
  heldCount: number;
  status: string;
  statusTone: StatusTone;
  receiptId: string | null;
  reconcileSaleId: string | null;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  onCloseDrawer: () => void;
  onAssignCustomer: () => void;
  onHold: () => void;
  onOpenHeldSales: () => void;
  onOpenDiscounts: () => void;
  onSetQty: (productId: string, delta: number) => void;
  onOpenPayment: () => void;
  onOpenGiftCardLoad?: () => void;
}

function money(minor: number): string {
  return minorToMajorFixed(minor);
}

export function PosResponsiveCart({
  cart,
  count,
  due,
  discountMinor,
  giftCardLoadMinor = 0,
  canPay,
  saleLocked,
  heldCount,
  status,
  statusTone,
  receiptId,
  reconcileSaleId,
  drawerOpen,
  onOpenDrawer,
  onCloseDrawer,
  onAssignCustomer,
  onHold,
  onOpenHeldSales,
  onOpenDiscounts,
  onSetQty,
  onOpenPayment,
  onOpenGiftCardLoad = () => undefined,
}: PosResponsiveCartProps) {
  return (
    <>
      <div
        role="region"
        aria-label="Mobile cart"
        className="fixed inset-x-0 bottom-0 z-30 h-[112px] border-t border-white/10 bg-[#171614] px-4 py-3 text-white shadow-[0_-14px_34px_-18px_rgb(0_0_0/0.72)] lg:hidden"
      >
        <div className="flex h-full items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold">{count} item{count === 1 ? "" : "s"} in cart</p>
            <p className="font-display mt-1 text-lg font-bold">₱{money(due)}</p>
            <p className="mt-1 truncate text-[9px] text-white/45">
              {cart.length === 0 ? "Tap a product to begin a sale." : cart.slice(0, 2).map((item) => item.name + " ×" + item.qty).join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenDrawer}
            className="h-11 shrink-0 rounded-[10px] border border-white/15 px-3 text-[10px] font-semibold text-white/80"
          >
            View cart
          </button>
          <button
            type="button"
            onClick={onOpenHeldSales}
            className="h-11 shrink-0 rounded-[10px] border border-white/15 px-2.5 text-[10px] font-semibold text-white/80"
          >
            Held {heldCount}
          </button>
          <button
            type="button"
            aria-label="Pay"
            onClick={onOpenPayment}
            disabled={!canPay}
            className="h-11 shrink-0 rounded-[10px] bg-[#f35d3f] px-4 text-[11px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] disabled:opacity-40"
          >
            Pay
          </button>
        </div>
      </div>

      <div
        role="region"
        aria-label="Tablet cart"
        className="fixed inset-x-0 bottom-0 z-30 hidden h-[160px] bg-[#171614] text-white shadow-[0_18px_48px_-18px_rgb(0_0_0/0.55)] lg:max-xl:block"
      >
        <div className="absolute left-7 top-6 max-w-[520px]">
          <p className="text-[12px] font-semibold">{count} item{count === 1 ? "" : "s"} in cart</p>
          <p className="mt-1 truncate text-[10px] text-white/45">
            {cart.length === 0 ? "Tap a product to begin a sale." : cart.slice(0, 3).map((item) => item.name + " ×" + item.qty).join(" · ")}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenDrawer}
          className="absolute left-7 top-[88px] h-12 w-[180px] rounded-[10px] border border-white/15 text-[11px] font-semibold text-white/80"
        >
          View cart
        </button>
        <button
          type="button"
          onClick={onOpenHeldSales}
          className="absolute left-[220px] top-[88px] h-12 w-[120px] rounded-[10px] border border-white/15 text-[11px] font-semibold text-white/80"
        >
          Held {heldCount}
        </button>
        <div className="absolute right-[221px] top-6 w-[123px] text-left">
          <p className="font-data text-[8px] uppercase tracking-[0.12em] text-white/45">Total</p>
          <p className="font-display mt-1 text-xl font-bold">₱{money(due)}</p>
        </div>
        <button
          type="button"
          aria-label="Pay"
          onClick={onOpenPayment}
          disabled={!canPay}
          className="absolute right-7 top-20 h-14 w-[290px] rounded-[10px] bg-[#f35d3f] font-display text-[12px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:opacity-40"
        >
          PAY ₱{money(due)}
        </button>
      </div>

      {status !== "" ? (
        <div role="region" aria-label="Tablet payment status" className="fixed inset-x-4 bottom-[124px] z-30 lg:max-xl:inset-x-7 lg:max-xl:bottom-[172px] xl:hidden">
          <div
            className={
              "rounded-xl border px-4 py-3 text-[12px] font-medium shadow-[0_14px_34px_-14px_rgb(0_0_0/0.55)] " +
              (statusTone === "ok"
                ? "border-[#2f6954] bg-[#173329] text-[#9de0c3]"
                : statusTone === "warn"
                  ? "border-[#755b28] bg-[#302717] text-[#ffd58a]"
                  : statusTone === "info"
                    ? "border-[#395d9c] bg-[#18243b] text-[#bfd0ff]"
                    : "border-white/10 bg-[#211f1d] text-white/75")
            }
          >
            <p role={status.includes("unknown") ? "alert" : "status"}>{status}</p>
            {reconcileSaleId ? (
              <Link href={"/sales/" + reconcileSaleId} className="mt-2 inline-flex font-semibold underline">
                Review unknown payment →
              </Link>
            ) : null}
            {receiptId ? (
              <Link href={"/receipts/" + receiptId} className="mt-2 inline-flex font-semibold underline">
                View receipt →
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {drawerOpen ? (
        <div
          className="fixed inset-0 z-[90] bg-black/45 p-3 sm:p-5 xl:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Tablet cart details"
        >
          <div className="ml-auto flex h-full w-full max-w-[420px] flex-col overflow-hidden rounded-[18px] border border-white/10 bg-[#171614] text-white shadow-[0_24px_60px_-18px_rgb(0_0_0/0.62)]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="font-display text-base font-semibold">Current sale</p>
                <p className="mt-1 text-[10px] text-white/45">{count} item{count === 1 ? "" : "s"} in cart</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenGiftCardLoad}
                  disabled={saleLocked}
                  className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-[#ffb7a4] hover:text-white disabled:opacity-35"
                >
                  Load card
                </button>
                <button
                  type="button"
                  onClick={onAssignCustomer}
                  disabled={saleLocked}
                  className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-white/70 hover:text-white disabled:opacity-35"
                >
                  Add customer
                </button>
                <button
                  type="button"
                  onClick={onHold}
                  disabled={cart.length === 0}
                  className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-white/70 hover:text-white disabled:opacity-35"
                >
                  {saleLocked ? "Re-hold" : "Hold"}
                </button>
                <button
                  type="button"
                  onClick={onOpenDiscounts}
                  disabled={cart.length === 0 || saleLocked || giftCardLoadMinor > 0}
                  className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-[#ff9a82] hover:text-[#ffb5a3] disabled:opacity-35"
                >
                  Discounts
                </button>
                <button
                  type="button"
                  aria-label="Close cart"
                  onClick={onCloseDrawer}
                  className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.07] text-white/65 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            <ul className="min-h-0 flex-1 space-y-2 overflow-auto px-5 py-4">
              {cart.length === 0 ? (
                <li className="rounded-xl bg-white/[0.04] p-6 text-center text-sm text-white/45">
                  Cart is empty. Tap products to add.
                </li>
              ) : null}
              {cart.map((item) => (
                <li key={item.productId} className="flex items-center gap-3 rounded-xl bg-white/[0.05] p-3">
                  <span className={"grid h-10 w-10 shrink-0 place-items-center rounded-lg " + productTileClass(item.name) + " text-sm font-extrabold"} aria-hidden>
                    {productInitials(item.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{item.name}</p>
                    <p className="money mt-1 text-[11px] text-white/45">₱{money(item.priceMinor)} each</p>
                    {item.lineDiscountMinor > 0 ? <p className="money mt-1 text-[10px] text-[#ff9a82]">Line discount −₱{money(item.lineDiscountMinor)}</p> : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSetQty(item.productId, -1)}
                      disabled={saleLocked}
                      aria-label={"Decrease " + item.name}
                      className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-sm font-bold disabled:opacity-35"
                    >
                      −
                    </button>
                    <span className="money w-6 text-center text-[13px] font-bold">{item.qty}</span>
                    <button
                      type="button"
                      onClick={() => onSetQty(item.productId, 1)}
                      disabled={saleLocked}
                      aria-label={"Increase " + item.name}
                      className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-sm font-bold hover:bg-[#f35d3f] disabled:opacity-35"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="border-t border-white/10 p-5">
              {discountMinor > 0 ? (
                <div className="mb-3 flex items-center justify-between text-[11px] text-white/55">
                  <span>Discounts</span>
                  <span className="money font-semibold text-[#ff9a82]">−₱{money(discountMinor)}</span>
                </div>
              ) : null}
              {giftCardLoadMinor > 0 ? <div className="mb-3 flex items-center justify-between text-[11px] text-[#ffb7a4]"><span>Gift-card load</span><span className="money font-semibold">₱{money(giftCardLoadMinor)}</span></div> : null}
              <div className="flex items-end justify-between">
                <div>
                  <p className="font-data text-[8px] uppercase tracking-[0.12em] text-white/45">Total</p>
                  <p className="font-display mt-1 text-2xl font-bold">₱{money(due)}</p>
                </div>
                <button
                  type="button"
                  onClick={onOpenPayment}
                  disabled={!canPay}
                  className="min-h-12 rounded-[10px] bg-[#f35d3f] px-7 font-display text-[12px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:opacity-40"
                >
                  Pay ₱{money(due)}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
