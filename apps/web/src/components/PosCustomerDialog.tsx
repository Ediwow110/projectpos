"use client";

import React from "react";
import { useEffect, useRef } from "react";

/** Same focusable set as components/Modal.tsx so the trap behaves identically here. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
}

interface PosCustomerDialogProps {
  customerQuery: string;
  customerId: string;
  walkIn: string;
  customers: CustomerOption[];
  onCustomerQueryChange: (query: string) => void;
  onSelectCustomer: (customer: CustomerOption) => void;
  onWalkInChange: (walkIn: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function PosCustomerDialog({
  customerQuery,
  customerId,
  walkIn,
  customers,
  onCustomerQueryChange,
  onSelectCustomer,
  onWalkInChange,
  onClear,
  onClose,
}: PosCustomerDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Captured during render (before the mount effect moves focus into the
  // dialog), exactly like Modal.tsx lines 48-51, so the opener can be restored.
  if (restoreFocusRef.current === null && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  onCloseRef.current = onClose;

  // Focus management lifted from components/Modal.tsx (lines 53-112): this is a
  // modal over a live sale, so focus must enter it, stay inside it, Escape must
  // dismiss it, and the opener must be restored when it closes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableElements = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");

    const frame = window.requestAnimationFrame(() => {
      if (dialog.contains(document.activeElement)) return;
      const first = focusableElements()[0];
      (first ?? dialog).focus();
    });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements();
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

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      const previousFocus = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      data-focus-trap="true"
      tabIndex={-1}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4 outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Customer assignment"
    >
      <div className="w-full max-w-lg rounded-[18px] border border-white/10 bg-[#171614] p-5 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-data text-[8px] uppercase tracking-[0.14em] text-[#ff765a]">Current sale</p>
            <h2 className="font-display mt-2 text-xl font-semibold">Assign customer</h2>
            <p className="mt-1 text-[11px] text-white/70">Choose an existing customer or keep a walk-in name for this sale.</p>
          </div>
          <button
            type="button"
            aria-label="Close customer assignment"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-white/70 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="relative block text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70">
            Customer
            <input
              value={customerQuery}
              onChange={(event) => onCustomerQueryChange(event.target.value)}
              placeholder="Search customers"
              className="field-dark mt-2 normal-case tracking-normal"
            />
            {customerQuery.trim() !== "" ? (
              <ul className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-xl border border-white/10 bg-[#252422] p-1 shadow-xl">
                {customers.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      onClick={() => onSelectCustomer(customer)}
                      className="min-h-11 w-full rounded-lg px-3 py-2 text-left text-[12px] normal-case hover:bg-white/10"
                    >
                      <span className="font-semibold">{customer.name}</span>
                      {customer.phone ? <span className="text-white/70"> — {customer.phone}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </label>

          <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70">
            Walk-in name
            <input
              value={walkIn}
              onChange={(event) => onWalkInChange(event.target.value)}
              placeholder="Optional"
              className="field-dark mt-2 normal-case tracking-normal"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <p className="text-[11px] text-white/70">
            {customerId !== "" ? `Selected: ${customerQuery}` : walkIn.trim() !== "" ? `Walk-in: ${walkIn.trim()}` : "No customer assigned"}
          </p>
          <div className="flex gap-2">
            {(customerId !== "" || walkIn.trim() !== "") ? (
              <button
                type="button"
                onClick={onClear}
                className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/70 hover:text-white"
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-lg bg-[#f35d3f] px-5 py-2 text-[11px] font-semibold text-white hover:bg-[#d94a30]"
            >
              Use for sale
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
