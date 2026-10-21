"use client";

import React from "react";
import type { JSX, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  variant = "standard",
  hideHeaderClose = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  variant?: "standard" | "atlasFlow";
  hideHeaderClose?: boolean;
}): JSX.Element | null {
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  // A hard-coded "modal-title" id collides whenever two modals are open at
  // once (for example the manager-approval dialog stacked over the shift-close
  // dialog): both sections then point aria-labelledby at the first match in the
  // DOM, so the inner dialog announces the outer dialog's title to assistive
  // technology. useId gives every instance its own label target.
  const titleId = useId();
  const descriptionId = useId();
  onCloseRef.current = onClose;

  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousFocus =
      restoreFocusRef.current ??
      (document.activeElement instanceof HTMLElement && !dialogRef.current?.contains(document.activeElement)
        ? document.activeElement
        : null);
    document.body.style.overflow = "hidden";

    const focusableElements = (): HTMLElement[] =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");

    const focusInitialElement = (): void => {
      if (dialogRef.current?.contains(document.activeElement)) return;
      const first = focusableElements()[0];
      (first ?? dialogRef.current)?.focus();
    };

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
        dialogRef.current?.focus();
        return;
      }

      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    const frame = window.requestAnimationFrame(focusInitialElement);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;
  const atlasFlow = variant === "atlasFlow";

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4 sm:p-6" role="presentation">
      <button
        type="button"
        aria-label="Close modal"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-[#17130f]/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-ui={atlasFlow ? "atlas-flow-modal" : undefined}
        className={"relative z-10 flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden shadow-[0_30px_80px_-24px_rgb(23_19_15/0.48)] sm:max-h-[calc(100vh-3rem)] " + (
          atlasFlow
            ? "max-w-[535px] rounded-[16px] border border-[#e4e9e3] bg-white sm:h-[min(585px,calc(100vh-3rem))]"
            : "max-w-[760px] rounded-[18px] border border-[#eadfd6] bg-[#fcf8f3]"
        )}
      >
        <header className={"flex items-start justify-between gap-4 border-b bg-white " + (atlasFlow ? "border-[#e4e9e3] px-[26px] pb-6 pt-7" : "border-[#eadfd6] px-5 py-4 sm:px-6")}>
          <div>
            {/* The eyebrow is 9-11px words, so both variants use the text-safe
                accent: --color-atlas-accent was 3.62:1 and the coral literal
                3.86:1 on the white header, --color-atlas-accent-strong is 5.90:1. */}
            <p className={"font-data font-medium uppercase " + (atlasFlow ? "text-[11px] tracking-[0.05em] text-[var(--color-atlas-accent-strong)]" : "text-[9px] tracking-[0.14em] text-[var(--color-atlas-accent-strong)]")}>{atlasFlow ? "Workflow step" : "Workspace action"}</p>
            <h2 id={titleId} className={"font-display font-semibold " + (atlasFlow ? "mt-7 text-[25px] text-[#202826]" : "mt-1 text-[22px] text-[#17130f]")}>{title}</h2>
            {description ? <p id={descriptionId} className={"max-w-2xl leading-5 " + (atlasFlow ? "mt-2 text-[14px] text-[var(--color-atlas-muted-strong)]" : "mt-1 text-[12px] text-[#73685f]")}>{description}</p> : null}
          </div>
          {!hideHeaderClose ? <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={"grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-lg transition " + (atlasFlow ? "border border-[#e4e9e3] bg-white text-[var(--color-atlas-muted-strong)] hover:bg-[#eff2ed] hover:text-[#202826]" : "border border-[#eee4db] bg-[#fcf8f3] text-[#73685f] hover:bg-[#fff0ea] hover:text-[var(--color-atlas-accent-strong)]")} // contrast-gate: non-text indicator (the x is a control glyph; the button is named by aria-label)
          >
            ×
          </button> : null}
        </header>
        <div className={"min-h-0 flex-1 overflow-y-auto " + (atlasFlow ? "px-[26px] py-5" : "px-5 py-5 sm:px-6")}>{children}</div>
        {footer ? <footer className={"border-t bg-white " + (atlasFlow ? "border-[#e4e9e3] px-[26px] py-[17px]" : "border-[#eadfd6] px-5 py-4 sm:px-6")}>{footer}</footer> : null}
      </section>
    </div>
  );
}
