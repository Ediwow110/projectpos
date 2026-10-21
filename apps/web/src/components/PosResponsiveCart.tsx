import React, { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";

import { minorToMajorFixed } from "../lib/money";
import type { PosCartEntry } from "../lib/pos-sale-model";
import { productInitials, productTileClass } from "../lib/pos-view";
import { validProductImageUrl } from "../lib/product-image";

type StatusTone = "ok" | "warn" | "info" | "neutral";

interface PosResponsiveCartProps {
  atlasV4?: boolean;
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
  /** The Load-card control only renders when a real handler can accept it. */
  onOpenGiftCardLoad?: () => void;
}

function money(minor: number): string {
  return minorToMajorFixed(minor);
}

export function PosResponsiveCart({
  atlasV4 = false,
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
  onOpenGiftCardLoad,
}: PosResponsiveCartProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const latestCloseDrawer = useRef(onCloseDrawer);
  latestCloseDrawer.current = onCloseDrawer;

  useEffect(() => {
    if (!drawerOpen) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => { if (origin?.isConnected) origin.focus(); };
  }, [drawerOpen]);

  function onDrawerKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      latestCloseDrawer.current();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => element.getClientRects().length > 0);
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  return (
    <>
      <div
        role="region"
        aria-label="Mobile cart"
        className={"fixed inset-x-0 bottom-0 z-30 h-[112px] border-t px-4 py-3 shadow-[0_-14px_34px_-18px_rgb(0_0_0/0.18)] lg:hidden " + (atlasV4 ? "border-[#e5e9e3] bg-white text-[#202826]" : "border-white/10 bg-[#171614] text-white")}
      >
        <div className="flex h-full items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold">{count} item{count === 1 ? "" : "s"} in cart</p>
            <p className="font-display mt-1 text-lg font-bold">₱{money(due)}</p>
            <p className={"mt-1 truncate text-[9px] " + (atlasV4 ? "text-[#53615a]" : "text-white/70")}>
              {cart.length === 0 ? "Tap a product to begin a sale." : cart.slice(0, 2).map((item) => item.name + " ×" + item.qty).join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenDrawer}
            className={"h-11 shrink-0 rounded-[10px] border px-3 text-[10px] font-semibold " + (atlasV4 ? "border-[#e5e9e3] bg-[#eff2ed] text-[#202826]" : "border-white/15 text-white/80")}
          >
            View cart
          </button>
          <button
            type="button"
            onClick={onOpenHeldSales}
            className={"h-11 shrink-0 rounded-[10px] border px-2.5 text-[10px] font-semibold " + (atlasV4 ? "border-[#e5e9e3] bg-[#eff2ed] text-[#202826]" : "border-white/15 text-white/80")}
          >
            Held {heldCount}
          </button>
          <button
            type="button"
            aria-label="Pay"
            onClick={onOpenPayment}
            disabled={!canPay}
            className={"h-11 shrink-0 rounded-[10px] px-4 text-[11px] font-semibold text-white disabled:opacity-40 " + (atlasV4 ? "bg-[#b84f3c]" : "bg-[#f35d3f] shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)]")}
          >
            Pay
          </button>
        </div>
      </div>

      <div
        role="region"
        aria-label="Tablet cart"
        className={"fixed inset-x-0 bottom-0 z-30 hidden h-[160px] border-t shadow-[0_18px_48px_-18px_rgb(0_0_0/0.16)] lg:max-xl:block " + (atlasV4 ? "border-[#e5e9e3] bg-white text-[#202826]" : "border-transparent bg-[#171614] text-white")}
      >
        <div className="absolute left-7 top-6 max-w-[520px]">
          <p className="text-[12px] font-semibold">{count} item{count === 1 ? "" : "s"} in cart</p>
          <p className={"mt-1 truncate text-[10px] " + (atlasV4 ? "text-[#53615a]" : "text-white/70")}>
            {cart.length === 0 ? "Tap a product to begin a sale." : cart.slice(0, 3).map((item) => item.name + " ×" + item.qty).join(" · ")}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenDrawer}
          className={"absolute left-7 top-[88px] h-12 w-[180px] rounded-[10px] border text-[11px] font-semibold " + (atlasV4 ? "border-[#e5e9e3] bg-[#eff2ed] text-[#202826]" : "border-white/15 text-white/80")}
        >
          View cart
        </button>
        <button
          type="button"
          onClick={onOpenHeldSales}
          className={"absolute left-[220px] top-[88px] h-12 w-[120px] rounded-[10px] border text-[11px] font-semibold " + (atlasV4 ? "border-[#e5e9e3] bg-[#eff2ed] text-[#202826]" : "border-white/15 text-white/80")}
        >
          Held {heldCount}
        </button>
        <div className="absolute right-[221px] top-6 w-[123px] text-left">
          <p className={"font-data text-[8px] uppercase tracking-[0.12em] " + (atlasV4 ? "text-[#53615a]" : "text-white/70")}>Total</p>
          <p className="font-display mt-1 text-xl font-bold">₱{money(due)}</p>
        </div>
        <button
          type="button"
          aria-label="Pay"
          onClick={onOpenPayment}
          disabled={!canPay}
          className={"absolute right-7 top-20 h-14 w-[290px] rounded-[10px] font-display text-[12px] font-semibold text-white disabled:opacity-40 " + (atlasV4 ? "bg-[#b84f3c] hover:bg-[#a94431]" : "bg-[#f35d3f] shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30]")}
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
          ref={drawerRef}
          data-focus-trap="true"
          onKeyDown={onDrawerKeyDown}
          className="fixed inset-0 z-[90] bg-black/45 p-3 sm:p-5 xl:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Tablet cart details"
        >
          <div className={"ml-auto flex h-full w-full max-w-[420px] flex-col overflow-hidden rounded-[18px] border shadow-[0_24px_60px_-18px_rgb(0_0_0/0.28)] " + (atlasV4 ? "border-[#e5e9e3] bg-white text-[#202826]" : "border-white/10 bg-[#171614] text-white")}>
            <div className={"flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 " + (atlasV4 ? "border-[#e5e9e3]" : "border-white/10")}>
              <div>
                <p className="font-display text-base font-semibold">Current sale</p>
                <p className={"mt-1 text-[10px] " + (atlasV4 ? "text-[#53615a]" : "text-white/70")}>{count} item{count === 1 ? "" : "s"} in cart</p>
              </div>
              <div className={"flex flex-wrap items-center gap-2 " + (atlasV4 ? "[&_button]:!border-[#e5e9e3] [&_button]:!text-[#202826] [&_button]:!bg-[#eff2ed]" : "")}>
                {onOpenGiftCardLoad ? (
                  <button
                    type="button"
                    onClick={onOpenGiftCardLoad}
                    disabled={saleLocked}
                    className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-[#ffb7a4] hover:text-white disabled:opacity-35"
                  >
                    Load card
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onAssignCustomer}
                  disabled={saleLocked}
                  className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-white/70 hover:text-white disabled:opacity-35"
                >
                  Add customer
                </button>
                <button
                  type="button"
                  onClick={onHold}
                  disabled={cart.length === 0}
                  className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-white/70 hover:text-white disabled:opacity-35"
                >
                  {saleLocked ? "Re-hold" : "Hold"}
                </button>
                <button
                  type="button"
                  onClick={onOpenDiscounts}
                  disabled={cart.length === 0 || saleLocked || giftCardLoadMinor > 0}
                  className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-[#ff9a82] hover:text-[#ffb5a3] disabled:opacity-35"
                >
                  Discounts
                </button>
                <button
                  ref={closeButtonRef}
                  type="button"
                  aria-label="Close cart"
                  onClick={onCloseDrawer}
                  className="grid h-11 w-11 place-items-center rounded-lg bg-white/[0.07] text-white/65 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            <ul className="min-h-0 flex-1 space-y-2 overflow-auto px-5 py-4">
              {cart.length === 0 ? (
                <li className={"rounded-xl p-6 text-center text-sm " + (atlasV4 ? "bg-[#f7f8f5] text-[#53615a]" : "bg-white/[0.04] text-white/70")}>
                  Cart is empty. Tap products to add.
                </li>
              ) : null}
              {cart.map((item) => (
                <li key={item.productId} className={"flex items-center gap-3 rounded-xl p-3 " + (atlasV4 ? "bg-[#f7f8f5]" : "bg-white/[0.05]")}>
                  <span className={"relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg " + productTileClass(item.name) + " text-sm font-extrabold"} aria-hidden>
                    {productInitials(item.name)}
                    {item.imageUrl && validProductImageUrl(item.imageUrl) ? <Image unoptimized src={item.imageUrl} alt="" fill sizes="40px" className="object-cover" /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{item.name}</p>
                    <p className={"money mt-1 text-[11px] " + (atlasV4 ? "text-[#53615a]" : "text-white/70")}>Qty {item.qty} × ₱{money(item.priceMinor)} = ₱{money(item.qty * item.priceMinor)}</p>
                    <p className={"money mt-1 text-[11px] " + (atlasV4 ? "text-[#53615a]" : "text-white/70")}>Line total ₱{money(Math.max(0, item.qty * item.priceMinor - item.lineDiscountMinor))}</p>
                    {item.lineDiscountMinor > 0 ? <p className="money mt-1 text-[10px] text-[#ff9a82]">Line discount −₱{money(item.lineDiscountMinor)}</p> : null}
                    <button type="button" onClick={() => onSetQty(item.productId, -item.qty)} disabled={saleLocked} aria-label={"Remove " + item.name} className={"mt-1 min-h-11 rounded-md px-2 text-[11px] font-semibold disabled:opacity-35 " + (atlasV4 ? "text-[#b04a39] hover:bg-[#fff0eb]" : "text-[#ff9a82] hover:bg-white/10")}>Remove</button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSetQty(item.productId, -1)}
                      disabled={saleLocked}
                      aria-label={"Decrease " + item.name}
                      className={"grid h-11 w-11 place-items-center rounded-md text-sm font-bold disabled:opacity-35 " + (atlasV4 ? "bg-[#e5e9e3]" : "bg-white/10")}
                    >
                      −
                    </button>
                    <span className="money w-6 text-center text-[13px] font-bold">{item.qty}</span>
                    <button
                      type="button"
                      onClick={() => onSetQty(item.productId, 1)}
                      disabled={saleLocked}
                      aria-label={"Increase " + item.name}
                      className={"grid h-11 w-11 place-items-center rounded-md text-sm font-bold disabled:opacity-35 " + (atlasV4 ? "bg-[#e5e9e3] hover:bg-[#dce3dc]" : "bg-white/10 hover:bg-[#f35d3f]")}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className={"border-t p-5 " + (atlasV4 ? "border-[#e5e9e3]" : "border-white/10")}>
              {discountMinor > 0 ? (
                <div className="mb-3 flex items-center justify-between text-[11px] text-white/55">
                  <span>Discounts</span>
                  <span className="money font-semibold text-[#ff9a82]">−₱{money(discountMinor)}</span>
                </div>
              ) : null}
              {giftCardLoadMinor > 0 ? <div className="mb-3 flex items-center justify-between text-[11px] text-[#ffb7a4]"><span>Gift-card load</span><span className="money font-semibold">₱{money(giftCardLoadMinor)}</span></div> : null}
              <div className="flex items-end justify-between">
                <div>
                  <p className={"font-data text-[8px] uppercase tracking-[0.12em] " + (atlasV4 ? "text-[#53615a]" : "text-white/70")}>Total</p>
                  <p className="font-display mt-1 text-2xl font-bold">₱{money(due)}</p>
                </div>
                <button
                  type="button"
                  onClick={onOpenPayment}
                  disabled={!canPay}
                  className={"min-h-12 rounded-[10px] px-7 font-display text-[12px] font-semibold text-white disabled:opacity-40 " + (atlasV4 ? "bg-[#b84f3c] hover:bg-[#a94431]" : "bg-[#f35d3f] shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30]")}
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
