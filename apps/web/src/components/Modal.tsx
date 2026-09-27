"use client";

import type { JSX, ReactNode } from "react";
import { useEffect, useRef } from "react";

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
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}): JSX.Element | null {
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
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
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-[760px] flex-col overflow-hidden rounded-[18px] border border-[#eadfd6] bg-[#fcf8f3] shadow-[0_30px_80px_-24px_rgb(23_19_15/0.48)] sm:max-h-[calc(100vh-3rem)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#eadfd6] bg-white px-5 py-4 sm:px-6">
          <div>
            <p className="font-data text-[9px] font-medium uppercase tracking-[0.14em] text-[#e44e34]">Workspace action</p>
            <h2 id="modal-title" className="font-display mt-1 text-[22px] font-bold text-[#17130f]">{title}</h2>
            {description ? <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[#73685f]">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#eee4db] bg-[#fcf8f3] text-lg text-[#73685f] transition hover:bg-[#fff0ea] hover:text-[#e44e34]"
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer ? <footer className="border-t border-[#eadfd6] bg-white px-5 py-4 sm:px-6">{footer}</footer> : null}
      </section>
    </div>
  );
}
