"use client";

import type { JSX, ReactNode } from "react";
import { useEffect } from "react";

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
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4 sm:p-6" role="presentation">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 cursor-default bg-[#17130f]/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
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
