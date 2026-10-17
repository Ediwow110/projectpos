"use client";

import React, { useEffect, useRef } from "react";

interface PosPaymentMethodChooserProps {
  effectiveMethod: string;
  offline: boolean;
  methodAvailable: (method: string) => boolean;
  onMethodChange: (method: string) => void;
  onContinue: () => void;
  onMoreMethods: () => void;
  onClose: () => void;
}

const METHODS = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card via PayMongo" },
  { key: "qrph", label: "QR Ph via PayMongo" },
] as const;

export function PosPaymentMethodChooser({
  effectiveMethod,
  offline,
  methodAvailable,
  onMethodChange,
  onContinue,
  onMoreMethods,
  onClose,
}: PosPaymentMethodChooserProps) {
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { backButton.current?.focus(); }, []);
  const enabled = (key: string): boolean => (!offline || key === "cash") && methodAvailable(key);

  return (
    <div
      className="fixed inset-0 z-[100] hidden place-items-center bg-[#202826]/35 p-4 backdrop-blur-[1px] xl:grid"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Payment"
        aria-labelledby="atlas-payment-chooser-title"
        data-ui="atlas-v4-payment-chooser"
        className="flex min-h-[586px] w-full max-w-[530px] flex-col rounded-[17px] bg-white px-[26px] pt-[30px] pb-[17px] text-[#202826] shadow-[0_20px_65px_-12px_rgb(20_32_27/0.22)]"
      >
        <p className="text-[10px] font-medium uppercase tracking-[0.05em] text-[#da614c]">Workflow step</p>
        <h2 id="atlas-payment-chooser-title" className="font-display mt-6 text-[23px] font-semibold">Choose a payment method</h2>
        <p className="mt-3 text-[13px] text-[#71807a]">Cash is local. Card and QR Ph use hosted payment.</p>
        <div className="mt-[40px] border-t border-[#e5e9e3] pt-[26px]">
          <div className="grid gap-[14px]">
            {METHODS.map((method) => (
              <button
                key={method.key}
                type="button"
                aria-label={method.key === "qrph" ? "QR Ph" : method.key === "card" ? "Card" : "Cash"}
                aria-pressed={effectiveMethod === method.key}
                disabled={!enabled(method.key)}
                title={!enabled(method.key) ? "This payment method is not configured or available" : undefined}
                onClick={() => onMethodChange(method.key)}
                className={
                  "flex min-h-[56px] w-full items-center justify-between rounded-[9px] border px-4 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c] disabled:cursor-not-allowed disabled:opacity-40 " +
                  (effectiveMethod === method.key
                    ? "border-[#aabbb0] bg-[#e9eee8] font-semibold text-[#202826]"
                    : "border-transparent bg-[#eff2ed] text-[#202826] hover:border-[#b6c6ba]")
                }
              >
                <span>{method.label}</span>
                {effectiveMethod === method.key && enabled(method.key) ? <span aria-hidden className="text-[#267552]">✓</span> : null}
              </button>
            ))}
          </div>
          <button type="button" onClick={onMoreMethods} className="mt-3 min-h-9 text-[12px] font-medium text-[#53615a] underline underline-offset-4 hover:text-[#202826]">
            Other payment methods
          </button>
        </div>
        <div className="mt-auto flex items-center justify-end gap-5 border-t border-[#e5e9e3] pt-[17px]">
          <button ref={backButton} type="button" onClick={onClose} aria-label="Back to sale"
            className="min-h-11 rounded-lg px-6 text-[13px] font-medium text-[#53615a] hover:bg-[#eff2ed]">
            Back
          </button>
          <button type="button" onClick={onContinue} disabled={!enabled(effectiveMethod)}
            className="min-h-11 min-w-[155px] rounded-[8px] bg-[#202826] px-8 text-[13px] font-semibold text-white transition-colors hover:bg-[#36443c] disabled:opacity-40">
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}
