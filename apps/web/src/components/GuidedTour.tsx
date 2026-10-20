"use client";

import React from "react";
import type { JSX } from "react";
import { NexposMark } from "./brand/NexposLogo";

export interface GuidedTourStep {
  title: string;
  body: string;
  target: string | null;
}

const OWNER_STEPS: GuidedTourStep[] = [
  {
    title: "Welcome to NexPOS",
    body: "This quick guide follows the normal store flow from setup to selling and review. You can skip it now and restart it any time from Help.",
    target: null,
  },
  {
    title: "Prepare your catalog",
    body: "Create the products you sell, then use Inventory to confirm opening stock and reorder levels. Accurate catalog and stock data keep checkout and reports trustworthy.",
    target: "products",
  },
  {
    title: "Open a shift before selling",
    body: "Use Shifts to choose the register, record the opening float, and establish the cash-control trail before the first transaction.",
    target: "shifts",
  },
  {
    title: "Complete a sale",
    body: "POS is the selling workspace: add products in the order the customer buys them, attach a customer when needed, then take Cash, Card, GCash, Maya, or QR Ph.",
    target: "pos",
  },
  {
    title: "Review receipts and reports",
    body: "Use Sales to find the completed transaction, receipt, refund history, or payment state. Reports then summarize sales, payments, products, inventory, staff, cash, and branches.",
    target: "sales",
  },
  {
    title: "Manage access and workspace settings",
    body: "Administration brings Team, Devices, Branches, Registers, and Help together so owner-only setup and access controls stay easy to find without crowding daily selling screens.",
    target: "admin",
  },
  {
    title: "Help is always available",
    body: "Use Restart tour whenever you want this walkthrough again. Closing, skipping, or finishing the tour stops it from appearing automatically on future sign-ins.",
    target: "tour-restart",
  },
];

const MANAGER_STEPS: GuidedTourStep[] = OWNER_STEPS.filter((step) => step.target !== "admin");

const CASHIER_STEPS: GuidedTourStep[] = [
  {
    title: "Welcome to NexPOS",
    body: "This guide follows the cashier flow from opening a shift to taking payment and finding the sale again. You can skip it now and restart it any time from Help.",
    target: null,
  },
  {
    title: "Open your shift",
    body: "Start in Shifts, choose the register, and enter the opening float before taking the first sale so cash reconciliation stays accurate.",
    target: "shifts",
  },
  {
    title: "Build the cart and take payment",
    body: "Use POS to scan or search products, adjust quantities, attach a customer when needed, and complete the transaction with an available payment method.",
    target: "pos",
  },
  {
    title: "Find the sale again",
    body: "Use Sales when you need the receipt, payment status, or an allowed follow-up action on a completed transaction.",
    target: "sales",
  },
  {
    title: "Help is always available",
    body: "Use Restart tour whenever you want this walkthrough again. Closing, skipping, or finishing the tour stops it from appearing automatically on future sign-ins.",
    target: "tour-restart",
  },
];

const INVENTORY_STEPS: GuidedTourStep[] = [
  {
    title: "Welcome to NexPOS",
    body: "This guide focuses on keeping sellable products and stock records accurate. You can skip it now and restart it any time from Help.",
    target: null,
  },
  {
    title: "Maintain the product catalog",
    body: "Use Products for names, SKUs, barcodes, pricing, categories, and sellable status before stock is received or adjusted.",
    target: "products",
  },
  {
    title: "Keep stock accurate",
    body: "Use Inventory to review on-hand quantities, reorder levels, and movement history. Record adjustments only with an operational reason.",
    target: "inventory",
  },
  {
    title: "Watch location and sync context",
    body: "Branches and Sync show where stock belongs and whether offline work still needs reconciliation before records are considered final.",
    target: "sync",
  },
  {
    title: "Help is always available",
    body: "Use Restart tour whenever you want this walkthrough again. Closing, skipping, or finishing the tour stops it from appearing automatically on future sign-ins.",
    target: "tour-restart",
  },
];

export function guidedTourStepsForRole(role?: string): GuidedTourStep[] {
  if (role === "cashier") return CASHIER_STEPS;
  if (role === "inventory") return INVENTORY_STEPS;
  if (role === "manager") return MANAGER_STEPS;
  return OWNER_STEPS;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function GuidedTour({
  open,
  role,
  onDismiss,
}: {
  open: boolean;
  role?: string;
  onDismiss: () => void;
}): JSX.Element | null {
  const [index, setIndex] = React.useState(0);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const dialogRef = React.useRef<HTMLElement | null>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const steps = guidedTourStepsForRole(role);
  const step = steps[Math.min(index, steps.length - 1)];

  React.useEffect(() => {
    if (!open) {
      returnFocusRef.current = null;
      return;
    }
    const opener = document.activeElement;
    if (opener instanceof HTMLElement && opener !== document.body) {
      returnFocusRef.current = opener;
    }
  }, [open]);

  const closeAndRestoreFocus = React.useCallback((): void => {
    const returnTo = returnFocusRef.current;
    onDismiss();
    requestAnimationFrame(() => {
      if (returnTo?.isConnected && returnTo.getClientRects().length > 0) {
        returnTo.focus();
      } else {
        // The automatic first-run tour may not have a visible opening button.
        // Keep keyboard users in the workspace rather than at document.body.
        const main = document.querySelector<HTMLElement>("main");
        if (main) {
          main.tabIndex = -1;
          main.focus();
        }
      }
    });
  }, [onDismiss]);

  React.useEffect(() => {
    if (!open) {
      setIndex(0);
      setRect(null);
      return;
    }
    const target = step.target
      ? Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`)).find(
          (candidate) => candidate.getClientRects().length > 0,
        ) ?? null
      : null;
    if (!target) {
      setRect(null);
      return;
    }
    target.scrollIntoView({ block: "nearest", inline: "center" });
    const update = (): void => {
      const box = target.getBoundingClientRect();
      setRect({
        top: Math.max(8, box.top - 6),
        left: Math.max(8, box.left - 6),
        width: box.width + 12,
        height: box.height + 12,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, step.target]);

  React.useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = (): HTMLElement[] =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    const preferred = dialog.querySelector<HTMLElement>('[data-tour-primary="true"]');
    (preferred ?? focusable()[0])?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, index, closeAndRestoreFocus]);

  if (!open) return null;

  const finalStep = index === steps.length - 1;
  return (
    <div className="fixed inset-0 z-[120]" role="presentation">
      <div className="absolute inset-0 bg-[#17130f]/60 backdrop-blur-[1px]" aria-hidden />
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl border-2 border-[#ff8a6b] shadow-[0_0_0_4px_rgb(255_240_234/0.92),0_16px_42px_-14px_rgb(0_0_0/0.55)]"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ) : null}

      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-tour-title"
        aria-describedby="workspace-tour-description"
        className={
          "fixed z-[122] w-[calc(100%-2rem)] max-w-[480px] rounded-[18px] border border-[#eee4db] bg-white p-5 text-[#17130f] shadow-[0_28px_80px_-22px_rgb(0_0_0/0.5)] sm:p-6 " +
          (index === 0 ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" : "bottom-5 left-1/2 -translate-x-1/2 sm:bottom-7")
        }
      >
        <div className="flex items-start gap-4">
          <NexposMark size={40} className="rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="font-data text-[9px] font-semibold uppercase tracking-[0.14em] text-[#e44e34]">
              System tour · {index + 1} of {steps.length}
            </p>
            <h2 id="workspace-tour-title" className="font-display mt-2 text-xl font-bold">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={closeAndRestoreFocus}
            aria-label="Close tour and do not show automatically again"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#eee4db] text-[#73685f] hover:border-[#f2b8a9] hover:text-[#d94a30]"
          >
            ✕
          </button>
        </div>

        <p id="workspace-tour-description" className="mt-4 text-[13px] leading-6 text-[#655b53]">{step.body}</p>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#f7f1ea]" aria-hidden>
          <span
            className="block h-full rounded-full bg-[#f35d3f] transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${((index + 1) / steps.length) * 100}%` }}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={closeAndRestoreFocus}
            className="min-h-10 rounded-[10px] px-3 text-[11px] font-semibold text-[#73685f] hover:bg-[#f7f1ea] hover:text-[#17130f]"
          >
            Skip tour
          </button>
          <div className="ml-auto flex gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={() => setIndex((current) => Math.max(0, current - 1))}
                className="min-h-10 rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-[11px] font-semibold text-[#2a241f] hover:border-[#f35d3f]"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              data-tour-primary="true"
              onClick={() => finalStep ? closeAndRestoreFocus() : setIndex((current) => Math.min(steps.length - 1, current + 1))}
              className="min-h-10 rounded-[10px] bg-[#f35d3f] px-5 text-[11px] font-semibold text-white hover:bg-[#d94a30]"
            >
              {finalStep ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
