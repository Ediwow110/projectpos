import React from "react";

import type { PosCartEntry } from "../lib/pos-sale-model";

export interface PosPaymentTile {
  key: string;
  label: string;
  tile: string;
}

interface PosPaymentWorkspaceProps {
  count: number;
  due: number;
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
  onInternalInstrumentIdChange?: (value: string) => void;
  onReceivedChange: (received: string) => void;
  onClose: () => void;
  onPay: () => void;
}

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function PosPaymentWorkspace({
  count,
  due,
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
  onInternalInstrumentIdChange = () => undefined,
  onReceivedChange,
  onClose,
  onPay,
}: PosPaymentWorkspaceProps) {
  const availableTiles = paymentTiles.filter((method) => !offline || method.key === "cash");
  const cashTender = effectiveMethod === "cash";
  const payMongoTender = ["card", "gcash", "maya", "qrph"].includes(effectiveMethod);
  const selectedMethodLabel = paymentTiles.find((method) => method.key === effectiveMethod)?.label ?? effectiveMethod;
  const title = (key: string) =>
    !methodAvailable(key) && ["card", "gcash", "maya", "qrph"].includes(key)
      ? "Configure PayMongo to enable this method"
      : undefined;

  return (
    <>
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 xl:hidden" role="dialog" aria-modal="true" aria-label="Payment">
        <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#171614] shadow-2xl animate-[rise_0.3s_ease_both]">
          <div className="flex items-center justify-between px-5 pt-4">
            <div>
              <h2 className="text-[15px] font-bold">Payment</h2>
              <p className="text-[11.5px] text-white/40">Current sale · {count} item{count === 1 ? "" : "s"}</p>
            </div>
            <button onClick={onClose} aria-label="Close payment" className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.07] text-white/60 hover:text-white">✕</button>
          </div>
          <p className="money mt-2 text-center text-[30px] font-extrabold">₱{money(due)}</p>
          <p className="text-center text-[11.5px] text-white/40">Total Amount</p>
          <div className="grid grid-cols-3 gap-2 px-5 pt-3">
            {availableTiles.map((method) => (
              <button
                key={method.key}
                type="button"
                onClick={() => onMethodChange(method.key)}
                disabled={!methodAvailable(method.key)}
                title={title(method.key)}
                className={`rounded-xl px-1 py-2.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${effectiveMethod === method.key ? method.tile + " text-white ring-2 ring-white/60" : "bg-white/[0.06] text-white/60 hover:bg-white/10"}`}
              >
                {method.label}
              </button>
            ))}
          </div>
          {offline ? <p className="px-5 pt-2 text-[11.5px] text-amber-300">Offline sales accept cash only.</p> : null}
          {cashTender ? (
            <div className="grid grid-cols-2 gap-2 px-5 pt-3">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                Amount Received
                <input
                  value={received}
                  onChange={(event) => onReceivedChange(event.target.value)}
                  placeholder={money(due)}
                  inputMode="decimal"
                  className="field-dark money mt-1.5"
                />
              </label>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                Change
                <p className="money mt-1.5 rounded-[10px] border border-green-500/30 bg-green-500/10 px-3 py-[9px] text-[15px] font-bold text-green-300">₱{money(changeMinor)}</p>
              </div>
            </div>
          ) : payMongoTender ? (
            <div className="mx-5 mt-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
              <p className="text-[12px] font-semibold text-white">Continue in PayMongo secure checkout</p>
              <p className="mt-1 text-[11px] leading-4 text-white/45">{selectedMethodLabel} payment is completed on PayMongo. NexPOS waits for the signed payment confirmation before finalizing the sale.</p>
            </div>
          ) : ["gift_card", "store_credit", "loyalty"].includes(effectiveMethod) ? (
            <label className="mx-5 mt-3 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
              {effectiveMethod === "gift_card" ? "Gift card ID" : effectiveMethod === "store_credit" ? "Customer-bound credit" : "Loyalty account"}
              <input value={internalInstrumentId} onChange={(event) => onInternalInstrumentIdChange(event.target.value)} placeholder={effectiveMethod === "gift_card" ? "Scan or enter card ID" : "Optional account ID"} className="field-dark mt-1.5" />
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-2 p-5">
            <button onClick={onClose} className="rounded-xl border border-white/15 py-2.5 text-sm font-semibold text-white/70 hover:text-white">Cancel</button>
            <button onClick={onPay} disabled={paying || !canPay} className="rounded-xl bg-[#f35d3f] py-2.5 text-sm font-bold shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:opacity-50">
              {paying ? "Processing…" : payMongoTender ? "Continue to PayMongo" : "Complete Payment"}
            </button>
          </div>
        </div>
      </div>

      <section
        data-ui="payment-workspace"
        role="dialog"
        aria-label="Payment"
        className="mx-auto hidden h-[866px] max-w-[1212px] overflow-hidden rounded-[20px] bg-[#191816] text-white shadow-[0_14px_34px_-12px_rgb(26_18_13/0.20)] xl:ml-0 xl:mr-auto xl:grid xl:grid-cols-[650px_562px]"
      >
        <div className="px-[46px] pt-14">
          <p className="font-data text-[9px] font-medium uppercase tracking-[0.05em] text-[#ff765a]">
            PAYMENT / {registerSelected ? "REGISTER SELECTED" : "NO REGISTER"}
          </p>
          <h2 className="font-display mt-5 text-[34px] font-bold">Take payment</h2>
          <p className="font-data mt-4 text-[9px] font-medium uppercase tracking-[0.05em] text-[#9e948c]">Amount due</p>
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
                <p className="font-data text-[9px] font-medium uppercase text-[#e44e34]">Change</p>
                <p className="money mt-2 text-[28px] font-bold">₱{money(changeMinor)}</p>
              </div>
            </>
          ) : payMongoTender ? (
            <div className="mt-[46px] w-[556px] rounded-xl border border-[#3b3732] bg-[#252422] px-5 py-5">
              <p className="text-[12px] font-semibold text-white">Continue in PayMongo secure checkout</p>
              <p className="mt-2 max-w-[500px] text-[10px] leading-5 text-[#a79e94]">{selectedMethodLabel} payment is completed on PayMongo. NexPOS will finalize the sale only after a signed payment confirmation is received.</p>
            </div>
          ) : ["gift_card", "store_credit", "loyalty"].includes(effectiveMethod) ? (
            <label className="mt-[46px] block w-[556px] text-[10px] font-semibold text-[#b7ada5]">
              {effectiveMethod === "gift_card" ? "Gift card ID" : effectiveMethod === "store_credit" ? "Customer-bound credit" : "Loyalty account"}
              <input value={internalInstrumentId} onChange={(event) => onInternalInstrumentIdChange(event.target.value)} placeholder={effectiveMethod === "gift_card" ? "Scan or enter card ID" : "Optional account ID"} className="field-dark mt-[11px]" />
            </label>
          ) : null}

          <button
            type="button"
            onClick={onPay}
            disabled={paying || !canPay}
            className="mt-[30px] h-16 w-[556px] rounded-xl bg-[#f35d3f] font-display text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(243_93_63/0.55)] hover:bg-[#d94a30] disabled:opacity-50"
          >
            {paying ? "Processing…" : payMongoTender ? "Continue to PayMongo   ENTER" : "Complete payment   ENTER"}
          </button>
        </div>

        <div className="bg-white px-9 pt-14 text-[#17130f]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-[20px] font-semibold">Sale summary</h3>
              <p className="font-data mt-3 text-[8px] uppercase tracking-[0.04em] text-[#8b8077]">
                DRAFT · {registerSelected ? "REGISTER" : "NO REGISTER"} · {now || "CURRENT"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#eee4db] px-3 py-2 text-[9px] font-semibold text-[#73685f] hover:text-[#d94a30]"
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
              <p className="font-data text-[8px] uppercase tracking-[0.06em] text-[#8b8077]">Current total</p>
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
