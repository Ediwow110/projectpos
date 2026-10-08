"use client";

import React from "react";
import type { JSX } from "react";

import { formatMoneyMinor } from "../lib/money";
import type { PosHeldSale } from "../lib/pos-sale-model";
import { Modal } from "./Modal";
import { GhostButton, PrimaryButton } from "./ui";

function money(minor: number): string {
  return formatMoneyMinor(minor);
}

function itemSummary(held: PosHeldSale): string {
  const ordered = [...held.sale.items].sort((a, b) => a.position - b.position);
  const preview = ordered.slice(0, 2).map((item) => `${item.name} ×${item.qty}`).join(" · ");
  const remaining = ordered.length - 2;
  return remaining > 0 ? `${preview} · +${remaining} more` : preview;
}

export function PosHeldSalesDialog({
  heldSales,
  loading,
  busySaleId,
  onResume,
  onClose,
}: {
  heldSales: PosHeldSale[];
  loading: boolean;
  busySaleId: string | null;
  onResume: (held: PosHeldSale) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal
      open
      title="Held sales"
      description="Resume one of your held carts. Held carts are private to the staff member who created them."
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <GhostButton type="button" onClick={onClose} disabled={busySaleId !== null}>Close</GhostButton>
        </div>
      }
    >
      <section aria-label="Held sales" className="space-y-3">
        {loading ? (
          <p className="rounded-xl bg-white px-4 py-5 text-sm text-[#73685f]">Loading held sales…</p>
        ) : null}

        {!loading && heldSales.length === 0 ? (
          <div className="rounded-xl border border-[#eee4db] bg-white px-5 py-8 text-center">
            <p className="font-display text-base font-semibold text-[#2a241f]">No held sales yet</p>
            <p className="mt-2 text-sm text-[#73685f]">Use Hold from the current sale when a customer needs to pause checkout.</p>
          </div>
        ) : null}

        {heldSales.map((held) => {
          const busy = busySaleId === held.sale.id;
          return (
            <article key={held.heldId} className="rounded-xl border border-[#eee4db] bg-white p-4 shadow-[0_4px_14px_-8px_rgb(28_20_15/0.10)]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-sm font-semibold text-[#2a241f]">{held.sale.customerName?.trim() || "Walk-in sale"}</p>
                    <span className="font-data rounded-full bg-[#f7f1ea] px-2 py-1 text-[9px] text-[#73685f]">{held.sale.id.slice(0, 8)}</span>
                  </div>
                  <p className="mt-2 truncate text-[11px] text-[#655b53]">{itemSummary(held)}</p>
                  <p className="font-data mt-2 text-[10px] text-[#8b8077]">
                    {new Date(held.sale.createdAt).toLocaleString("en-PH")} · {held.sale.items.length} line{held.sale.items.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 sm:block sm:text-right">
                  <p className="money text-base font-bold text-[#2a241f]">₱{money(held.sale.totalMinor)}</p>
                  <PrimaryButton
                    type="button"
                    className="sm:mt-2"
                    onClick={() => onResume(held)}
                    disabled={busySaleId !== null}
                    aria-busy={busy}
                  >
                    {busy ? "Resuming…" : "Resume sale"}
                  </PrimaryButton>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </Modal>
  );
}
