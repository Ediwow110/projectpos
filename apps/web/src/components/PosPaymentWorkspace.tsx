import React, { useEffect, useRef } from "react";
import Link from "next/link";

import { minorToMajorFixed } from "../lib/money";
import { isRetryBlocked, type PosCheckoutFailure } from "../lib/pos-checkout-feedback";
import type { PosCartEntry } from "../lib/pos-sale-model";

/** Same focusable set as components/Modal.tsx so the trap behaves identically here. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface PosPaymentTile {
  key: string;
  label: string;
  tile: string;
}

interface PosPaymentWorkspaceProps {
  atlasV4?: boolean;
  count: number;
  due: number;
  giftCardLoadMinor?: number;
  changeMinor: number;
  registerSelected: boolean;
  now: string;
  cart: PosCartEntry[];
  paymentTiles: PosPaymentTile[];
  offline: boolean;
  effectiveMethod: string;
  received: string;
  paying: boolean;
  canPay: boolean;
  methodAvailable: (key: string) => boolean;
  onMethodChange: (method: string) => void;
  internalInstrumentId?: string;
  /** Optional tenders only render their ID field when a real handler can accept it. */
  onInternalInstrumentIdChange?: (value: string) => void;
  onReceivedChange: (received: string) => void;
  onClose: () => void;
  onPay: () => void;
  /** Failure scoped to the open payment transaction, never rendered in the cart behind it. */
  failure?: PosCheckoutFailure | null;
}

function money(minor: number): string {
  return minorToMajorFixed(minor);
}

type FailureSurface = "atlas" | "mobile" | "desktop";

function PaymentFailureAlert({
  failure,
  surface,
  onAdjustCart,
}: {
  failure: PosCheckoutFailure;
  surface: FailureSurface;
  onAdjustCart: () => void;
}) {
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alertRef.current?.focus();
  }, [failure]);

  const id = `payment-failure-${surface}`;
  const action = failure.action;
  const atlas = surface === "atlas";
  const surfaceClass =
    atlas
      ? "mt-5 rounded-[8px] border border-[#e8b4a8] bg-[#fff0eb] px-4 py-3 text-[12px] leading-5 text-[#7a2f22]"
      : surface === "desktop"
        ? "mt-[30px] w-[556px] rounded-xl border border-red-400/40 bg-red-500/15 px-5 py-4 text-[11px] leading-5 text-red-100"
        : "mx-5 mt-3 rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-[11px] leading-5 text-red-100";
  const actionClass = atlas
    ? "mt-2 font-semibold underline"
    : "mt-2 font-semibold text-white underline";

  return (
    <div
      ref={alertRef}
      id={id}
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      data-ui="payment-failure"
      data-failure-kind={failure.kind}
      className={`${surfaceClass} outline-none`}
    >
      <p className="font-semibold">{failure.title}</p>
      <p className="mt-1">{failure.message}</p>
      {action.kind === "adjust_cart" ? (
        <button type="button" onClick={onAdjustCart} className={actionClass}>
          {action.label}
        </button>
      ) : null}
      {action.kind === "open_shift" || action.kind === "sign_in" || action.kind === "check_sale" ? (
        <Link href={action.href} className={`${actionClass} inline-flex`}>
          {action.label}
        </Link>
      ) : null}
      {failure.correlationId ? (
        <p className="mt-2 text-[10px] opacity-70">Reference: {failure.correlationId}</p>
      ) : null}
    </div>
  );
}

export function PosPaymentWorkspace({
  atlasV4 = false,
  count,
  due,
  giftCardLoadMinor = 0,
  changeMinor,
  registerSelected,
  now,
  cart,
  paymentTiles,
  offline,
  effectiveMethod,
  received,
  paying,
  canPay,
  methodAvailable,
  onMethodChange,
  internalInstrumentId = "",
  onInternalInstrumentIdChange,
  onReceivedChange,
  onClose,
  onPay,
  failure = null,
}: PosPaymentWorkspaceProps) {
  const retryBlocked = isRetryBlocked(failure);
  const desktopHeading = useRef<HTMLHeadingElement>(null);
  const mobileHeading = useRef<HTMLHeadingElement>(null);
  const mobileOverlay = useRef<HTMLDivElement>(null);
  const desktopPanel = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Captured during render (before the mount effect moves focus into the
  // workspace), like Modal.tsx lines 48-51, so the sale's control is restored.
  if (restoreFocusRef.current === null && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  onCloseRef.current = onClose;
  // The legacy surfaces render both a mobile sheet and an xl inline panel;
  // only the breakpoint-visible one owns focus, so the trap targets whichever
  // sheet is visible at event time instead of the one visible at mount.
  useEffect(() => {
    const largeScreens = window.matchMedia("(min-width: 1280px)");
    const visibleSurface = (): HTMLElement | null => (largeScreens.matches ? desktopPanel : mobileOverlay).current;
    const focusHeading = (): void => {
      (largeScreens.matches || atlasV4 ? desktopHeading : mobileHeading).current?.focus();
    };
    focusHeading();
    if (atlasV4) return;

    // Focus management lifted from components/Modal.tsx (lines 53-112): the
    // payment workspace covers a live sale, so keyboard focus must enter it,
    // stay inside it, Escape must dismiss it, and the opener must be restored.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableElements = (dialog: HTMLElement): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");

    const onKeyDown = (event: KeyboardEvent): void => {
      const dialog = visibleSurface();
      if (!dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements(dialog);
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    const onViewportChange = (): void => focusHeading();

    window.addEventListener("keydown", onKeyDown);
    largeScreens.addEventListener("change", onViewportChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      largeScreens.removeEventListener("change", onViewportChange);
      document.body.style.overflow = previousOverflow;
      const previousFocus = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [atlasV4]);
  const availableTiles = paymentTiles.filter((method) => !offline || method.key === "cash");
  const prominentMethods = availableTiles.filter((method) => ["cash", "card", "qrph"].includes(method.key));
  const additionalMethods = availableTiles.filter((method) => !["cash", "card", "qrph"].includes(method.key));
  const [showAdditionalMethods, setShowAdditionalMethods] = React.useState(!["cash", "card", "qrph"].includes(effectiveMethod));
  const cashTender = effectiveMethod === "cash";
  const payMongoTender = ["card", "gcash", "maya", "qrph"].includes(effectiveMethod);
  // Item 4: the internal-instrument field must never render against a dead
  // no-op handler, so it is gated on the callback actually being supplied.
  const internalTender = ["gift_card", "store_credit", "loyalty"].includes(effectiveMethod) && onInternalInstrumentIdChange !== undefined;
  const selectedMethodLabel = paymentTiles.find((method) => method.key === effectiveMethod)?.label ?? effectiveMethod;
  const title = (key: string) =>
    !methodAvailable(key) && ["card", "gcash", "maya", "qrph"].includes(key)
      ? "Configure PayMongo to enable this method"
      : undefined;

  const paymentDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = paymentDialogRef.current;
    if (!atlasV4 || !dialog || dialog.open) return;
    dialog.showModal();
  }, [atlasV4]);

  if (atlasV4) return (
    <dialog ref={paymentDialogRef} aria-label="Payment" onClose={onClose}
      className="m-auto w-[min(94vw,540px)] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[14px] border border-[#e5e9e3] bg-white p-0 text-[#202826] shadow-[0_24px_80px_rgba(20,30,25,0.22)] backdrop:bg-[#202826]/40"
      data-ui="payment-workspace">
      <div className="px-5 pt-6 sm:px-7">
        <p className="font-data text-[10px] uppercase tracking-widest text-[#b04a39]">Workflow step</p>
        <h2 ref={desktopHeading} tabIndex={-1} className="font-display mt-4 text-[21px] font-semibold outline-none">Take payment</h2>
        <p className="mt-2 text-xs leading-5 text-[#53615a]">Cash is local. Card and QR Ph use hosted payment when configured.</p>
        <p className="mt-4 border-b border-[#e5e9e3] pb-4 font-data text-[12px] text-[#53615a]">Total due <strong className="ml-2 font-display text-[18px] text-[#202826]">₱{money(due)}</strong> · {count} unit{count === 1 ? "" : "s"}</p>
        <fieldset className="mt-5 space-y-2.5">
          <legend className="sr-only">Payment methods</legend>
          {prominentMethods.map((method) => <button key={method.key} type="button" onClick={() => onMethodChange(method.key)} disabled={!methodAvailable(method.key)} title={title(method.key)}
            aria-pressed={effectiveMethod === method.key}
            className={"flex min-h-[46px] w-full items-center justify-between rounded-[8px] border px-3 text-left text-[13px] text-[#202826] transition-colors disabled:cursor-not-allowed disabled:opacity-40 " + (effectiveMethod === method.key ? "border-[#267552] bg-[#eaf7f0] font-semibold" : "border-transparent bg-[#eff2ed] hover:border-[#dce3dc]")}>{method.label}{effectiveMethod === method.key ? <span aria-hidden className="text-[#267552]">✓</span> : null}</button>)}
        </fieldset>
        {additionalMethods.length > 0 ? <>
          <button type="button" aria-expanded={showAdditionalMethods} aria-controls="additional-payment-methods" onClick={() => setShowAdditionalMethods((open) => !open)}
            className="mt-3 min-h-11 w-full rounded-[8px] border border-[#e5e9e3] text-xs font-medium text-[#53615a] hover:bg-[#eff2ed]">{showAdditionalMethods ? "Fewer payment methods" : "Other payment methods"} {showAdditionalMethods ? "−" : "+"}</button>
          <div id="additional-payment-methods" hidden={!showAdditionalMethods} className="mt-2 max-h-36 space-y-2 overflow-y-auto pb-1">
            {additionalMethods.map((method) => <button key={method.key} type="button" onClick={() => onMethodChange(method.key)} disabled={!methodAvailable(method.key)} title={title(method.key)} aria-pressed={effectiveMethod === method.key}
              className={"flex min-h-11 w-full items-center justify-between rounded-[8px] border px-3 text-left text-xs disabled:opacity-40 " + (effectiveMethod === method.key ? "border-[#267552] bg-[#eaf7f0] font-semibold text-[#202826]" : "border-[#e5e9e3] bg-[#f7f8f5] text-[#53615a]")}>{method.label}{effectiveMethod === method.key ? <span aria-hidden>✓</span> : null}</button>)}
          </div>
        </> : null}
        {offline ? <p className="mt-3 text-xs text-[#946c31]">Offline sales accept cash only.</p> : null}
        {giftCardLoadMinor > 0 ? <p className="mt-3 text-xs text-[#a34132]">Includes gift-card load ₱{money(giftCardLoadMinor)} · external tender only.</p> : null}
        {cashTender ? <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-[12px] font-medium text-[#53615a]">Amount Received
            <input inputMode="decimal" value={received} onChange={(event) => onReceivedChange(event.target.value)} placeholder={money(due)} className="font-data mt-1.5 h-12 w-full rounded-[8px] border border-[#dce3dc] bg-white px-3 text-sm text-[#202826] focus-visible:outline-2 focus-visible:outline-[#267552]" />
          </label>
          <div className="text-[12px] font-medium text-[#53615a]">Change
            <p className="font-data mt-1.5 flex h-12 items-center rounded-[8px] bg-[#eff2ed] px-3 text-sm text-[#267552]">₱{money(changeMinor)}</p>
          </div>
        </div> : null}
        {payMongoTender ? <p className="mt-4 rounded-[8px] bg-[#eff2ed] p-3 text-xs leading-5 text-[#53615a]">Continue in PayMongo secure checkout. NexPOS only completes this sale after verified payment confirmation; returning to this page alone never confirms payment.</p> : null}
        {internalTender ? <label className="mt-4 block text-xs text-[#53615a]">{effectiveMethod === "gift_card" ? "Gift card ID" : effectiveMethod === "store_credit" ? "Customer-bound credit" : "Loyalty account"}
          <input value={internalInstrumentId} onChange={(e) => onInternalInstrumentIdChange?.(e.target.value)} placeholder="Scan or enter ID" className="mt-1.5 h-12 w-full rounded-lg border border-[#dce3dc] px-3 text-sm text-[#202826]" />
        </label> : null}
        <div className="mt-5 border-t border-[#e5e9e3] pt-3">
          <h3 className="text-[12px] font-semibold text-[#202826]">Sale summary</h3>
          <p className="font-data mt-1 text-[10px] uppercase text-[#53615a]">{registerSelected ? "Register selected" : "No register selected"} · {now || "Current"}</p>
          <ul className="mt-2 max-h-24 overflow-y-auto text-[12px] text-[#53615a]">{cart.map((item) => <li key={item.productId} className="flex justify-between gap-3 py-1"><span className="min-w-0 truncate">{item.qty} × {item.name}</span><span className="shrink-0 font-data">₱{money(Math.max(0, item.qty * item.priceMinor - item.lineDiscountMinor))}</span></li>)}</ul>
        </div>
        {failure ? <PaymentFailureAlert failure={failure} surface="atlas" onAdjustCart={onClose} /> : null}
      </div>
      <div className="sticky bottom-0 z-10 mt-5 flex gap-3 border-t border-[#e5e9e3] bg-white px-5 py-4 sm:px-7">
        <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-[8px] text-[13px] font-medium text-[#202826] hover:bg-[#eff2ed]">Back to sale</button>
        <button type="button" onClick={onPay} disabled={paying || !canPay || retryBlocked} aria-describedby={failure ? "payment-failure-atlas" : undefined} className="min-h-11 flex-1 rounded-[8px] bg-[#202826] px-3 text-[13px] font-semibold text-white hover:bg-[#35413b] disabled:opacity-40">{paying ? "Processing…" : payMongoTender ? "Continue to PayMongo" : "Complete Payment"}</button>
      </div>
    </dialog>
  );

  return (
    <>
      <div ref={mobileOverlay} data-focus-trap="true" tabIndex={-1} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 outline-none xl:hidden" role="dialog" aria-modal="true" aria-label="Payment">
        <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#171614] shadow-2xl animate-[rise_0.3s_ease_both]">
          <div className="flex items-center justify-between px-5 pt-4">
            <div>
              <h2 ref={mobileHeading} tabIndex={-1} className="text-[15px] font-bold outline-none">Payment</h2>
              <p className="text-[11.5px] text-white/70">Current sale · {count} item{count === 1 ? "" : "s"}</p>
            </div>
            <button onClick={onClose} aria-label="Close payment" className="grid h-11 w-11 place-items-center rounded-lg bg-white/[0.07] text-white/70 hover:text-white">✕</button>
          </div>
          <p className="money mt-2 text-center text-[30px] font-extrabold">₱{money(due)}</p>
          <p className="text-center text-[11.5px] text-white/70">Total Amount</p>
          {giftCardLoadMinor > 0 ? <p className="px-5 pt-2 text-center text-[11px] text-[#ffb7a4]">Includes gift-card load ₱{money(giftCardLoadMinor)} · external tender only</p> : null}
          <div className="grid grid-cols-3 gap-2 px-5 pt-3">
            {availableTiles.map((method) => (
              <button
                key={method.key}
                type="button"
                onClick={() => onMethodChange(method.key)}
                disabled={!methodAvailable(method.key)}
                title={title(method.key)}
                className={`min-h-11 rounded-xl px-1 py-2.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${effectiveMethod === method.key ? method.tile + " text-white ring-2 ring-white/60" : "bg-white/[0.06] text-white/60 hover:bg-white/10"}`}
              >
                {method.label}
              </button>
            ))}
          </div>
          {offline ? <p className="px-5 pt-2 text-[11.5px] text-amber-300">Offline sales accept cash only.</p> : null}
          {cashTender ? (
            <div className="grid grid-cols-2 gap-2 px-5 pt-3">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/70">
                Amount Received
                <input
                  value={received}
                  onChange={(event) => onReceivedChange(event.target.value)}
                  placeholder={money(due)}
                  inputMode="decimal"
                  className="field-dark money mt-1.5"
                />
              </label>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                Change
                <p className="money mt-1.5 rounded-[10px] border border-green-500/30 bg-green-500/10 px-3 py-[9px] text-[15px] font-bold text-green-300">₱{money(changeMinor)}</p>
              </div>
            </div>
          ) : payMongoTender ? (
            <div className="mx-5 mt-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
              <p className="text-[12px] font-semibold text-white">Continue in PayMongo secure checkout</p>
              <p className="mt-1 text-[11px] leading-4 text-white/70">{selectedMethodLabel} payment is completed on PayMongo. NexPOS waits for the signed payment confirmation before finalizing the sale.</p>
            </div>
          ) : internalTender ? (
            <label className="mx-5 mt-3 block text-[11px] font-semibold uppercase tracking-wider text-white/70">
              {effectiveMethod === "gift_card" ? "Gift card ID" : effectiveMethod === "store_credit" ? "Customer-bound credit" : "Loyalty account"}
              <input value={internalInstrumentId} onChange={(event) => onInternalInstrumentIdChange?.(event.target.value)} placeholder={effectiveMethod === "gift_card" ? "Scan or enter card ID" : "Optional account ID"} className="field-dark mt-1.5" />
            </label>
          ) : null}
          {failure ? <PaymentFailureAlert failure={failure} surface="mobile" onAdjustCart={onClose} /> : null}
          <div className="grid grid-cols-2 gap-2 p-5">
            <button onClick={onClose} className="min-h-11 rounded-xl border border-white/15 py-2.5 text-sm font-semibold text-white/70 hover:text-white">Cancel</button>
            <button onClick={onPay} disabled={paying || !canPay || retryBlocked} aria-describedby={failure ? "payment-failure-mobile" : undefined} className="min-h-11 rounded-xl bg-[#f35d3f] py-2.5 text-sm font-bold shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:opacity-50">
              {paying ? "Processing…" : payMongoTender ? "Continue to PayMongo" : "Complete Payment"}
            </button>
          </div>
        </div>
      </div>

      <section
        ref={desktopPanel}
        data-ui="payment-workspace"
        data-focus-trap="true"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Payment"
        className="mx-auto hidden h-[866px] max-w-[1212px] overflow-hidden rounded-[20px] bg-[#191816] text-white shadow-[0_14px_34px_-12px_rgb(26_18_13/0.20)] outline-none xl:ml-0 xl:mr-auto xl:grid xl:grid-cols-[650px_562px]"
      >
        <div className="px-[46px] pt-14">
          <p className="font-data text-[9px] font-medium uppercase tracking-[0.05em] text-[#ff765a]">
            PAYMENT / {registerSelected ? "REGISTER SELECTED" : "NO REGISTER"}
          </p>
          <h2 ref={desktopHeading} tabIndex={-1} className="font-display mt-5 text-[34px] font-bold outline-none">Take payment</h2>
          <p className="font-data mt-4 text-[9px] font-medium uppercase tracking-[0.05em] text-[#9e948c]">Amount due</p>
          {giftCardLoadMinor > 0 ? <p className="mt-2 text-[10px] text-[#ffb7a4]">Gift-card load ₱{money(giftCardLoadMinor)} · external tender only</p> : null}
          <p className="money mt-1 text-[50px] font-bold leading-none">₱{money(due)}</p>

          <div className="mt-[42px] grid w-[556px] grid-cols-3 gap-3.5">
            {availableTiles.map((method) => (
              <button
                key={method.key}
                type="button"
                onClick={() => onMethodChange(method.key)}
                disabled={!methodAvailable(method.key)}
                title={title(method.key)}
                className={
                  "h-[52px] rounded-[10px] border text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 " +
                  (effectiveMethod === method.key
                    ? "border-[#f35d3f] bg-[#f35d3f] text-white"
                    : "border-[#3b3732] bg-[#252422] text-[#d5cdc6] hover:border-[#5a524b]")
                }
              >
                {method.label}
              </button>
            ))}
          </div>

          {offline ? <p className="mt-3 text-[11px] font-medium text-amber-300">Offline sales accept cash only.</p> : null}

          {cashTender ? (
            <>
              <label className="mt-[46px] block w-[556px] text-[10px] font-semibold text-[#b7ada5]">
                Cash received
                <input
                  value={received}
                  onChange={(event) => onReceivedChange(event.target.value)}
                  placeholder={money(due)}
                  inputMode="decimal"
                  className="field-dark money mt-[11px] !h-[66px] !rounded-[10px] !px-4 !text-[25px] !font-semibold"
                />
              </label>

              <div className="mt-6 h-[92px] w-[556px] rounded-xl bg-[#fff0ea] px-4 py-4 text-[#17130f]">
                <p className="font-data text-[9px] font-medium uppercase text-[var(--color-atlas-accent-strong)]">Change</p>
                <p className="money mt-2 text-[28px] font-bold">₱{money(changeMinor)}</p>
              </div>
            </>
          ) : payMongoTender ? (
            <div className="mt-[46px] w-[556px] rounded-xl border border-[#3b3732] bg-[#252422] px-5 py-5">
              <p className="text-[12px] font-semibold text-white">Continue in PayMongo secure checkout</p>
              <p className="mt-2 max-w-[500px] text-[10px] leading-5 text-[#a79e94]">{selectedMethodLabel} payment is completed on PayMongo. NexPOS will finalize the sale only after a signed payment confirmation is received.</p>
            </div>
          ) : internalTender ? (
            <label className="mt-[46px] block w-[556px] text-[10px] font-semibold text-[#b7ada5]">
              {effectiveMethod === "gift_card" ? "Gift card ID" : effectiveMethod === "store_credit" ? "Customer-bound credit" : "Loyalty account"}
              <input value={internalInstrumentId} onChange={(event) => onInternalInstrumentIdChange?.(event.target.value)} placeholder={effectiveMethod === "gift_card" ? "Scan or enter card ID" : "Optional account ID"} className="field-dark mt-[11px]" />
            </label>
          ) : null}

          {failure ? <PaymentFailureAlert failure={failure} surface="desktop" onAdjustCart={onClose} /> : null}
          <button
            type="button"
            onClick={onPay}
            disabled={paying || !canPay || retryBlocked}
            aria-describedby={failure ? "payment-failure-desktop" : undefined}
            className="mt-[30px] h-16 w-[556px] rounded-xl bg-[#f35d3f] font-display text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:opacity-50"
          >
            {paying ? "Processing…" : payMongoTender ? "Continue to PayMongo   ENTER" : "Complete payment   ENTER"}
          </button>
        </div>

        <div className="bg-white px-9 pt-14 text-[#17130f]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-[20px] font-semibold">Sale summary</h3>
              <p className="font-data mt-3 text-[8px] uppercase tracking-[0.04em] text-[var(--color-atlas-muted-strong)]">
                DRAFT · {registerSelected ? "REGISTER" : "NO REGISTER"} · {now || "CURRENT"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-lg border border-[#eee4db] px-3 py-2 text-[9px] font-semibold text-[#73685f] hover:text-[#d94a30]"
            >
              Back to sale
            </button>
          </div>

          <ul className="mt-10 space-y-6">
            {cart.map((item) => (
              <li key={item.productId} className="flex items-center justify-between gap-4 text-[10px] font-semibold text-[#2a241f]">
                <span className="min-w-0 truncate">{item.qty} × {item.name}</span>
                <span className="money shrink-0 text-[9px]">₱{money(item.qty * item.priceMinor)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-12 border-t border-[#eee4db] pt-10">
            <div className="rounded-xl bg-[#edf3ff] p-4 text-[#2b4f94]">
              <p className="text-[11px] font-semibold">If payment status becomes uncertain</p>
              <p className="mt-4 text-[10px] leading-5 text-[#394967]">
                Keep the sale in context and reconcile the provider result. NexPOS will not present an unknown payment as successful or ask you to retry blindly.
              </p>
            </div>
            <div className="mt-6 rounded-xl bg-[#fcf8f3] px-4 py-4">
              <p className="font-data text-[8px] uppercase tracking-[0.06em] text-[var(--color-atlas-muted-strong)]">Current total</p>
              <div className="mt-2 flex items-end justify-between">
                <span className="text-[11px] font-semibold text-[#51483f]">{count} item{count === 1 ? "" : "s"}</span>
                <span className="money text-[22px] font-bold text-[#17130f]">₱{money(due)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
