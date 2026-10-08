"use client";

import React, { useMemo, useState } from "react";
import type { FormEvent, JSX } from "react";

import { exchangePreview } from "../lib/exchange-view";
import { formatMoneyMinor } from "../lib/money";
import { Modal } from "./Modal";
import { GhostButton, PrimaryButton } from "./ui";

function money(minor: number): string {
  return formatMoneyMinor(minor);
}

export interface SaleExchangeLine {
  id: string;
  name: string;
  qty: number;
  lineTotalMinor: number;
  alreadyRefundedQty: number;
}

export interface SaleExchangeProduct {
  id: string;
  name: string;
  priceMinor: number;
  taxRateBps: number | null;
}

export function SaleExchangeDialog({
  lines,
  products,
  businessTaxRateBps,
  search,
  productsLoading,
  busy,
  error,
  onSearchChange,
  onSubmit,
  onClose,
}: {
  lines: SaleExchangeLine[];
  products: SaleExchangeProduct[];
  businessTaxRateBps: number | null;
  search: string;
  productsLoading: boolean;
  busy: boolean;
  error: string;
  onSearchChange: (value: string) => void;
  onSubmit: (input: {
    returns: Array<{ saleItemId: string; qty: number }>;
    replacements: Array<{ productId: string; qty: number }>;
    reason: string;
  }) => void;
  onClose: () => void;
}): JSX.Element {
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [replacementQty, setReplacementQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");

  const numericReturnQty = useMemo(() => Object.fromEntries(
    lines.map((line) => [line.id, Number(returnQty[line.id] ?? 0)]),
  ), [lines, returnQty]);
  const numericReplacementQty = useMemo(() => Object.fromEntries(
    products.map((product) => [product.id, Number(replacementQty[product.id] ?? 0)]),
  ), [products, replacementQty]);
  const preview = useMemo(() => exchangePreview({
    lines,
    products,
    returnQty: numericReturnQty,
    replacementQty: numericReplacementQty,
    businessTaxRateBps,
  }), [businessTaxRateBps, lines, numericReplacementQty, numericReturnQty, products]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const returns: Array<{ saleItemId: string; qty: number }> = [];
    for (const line of lines) {
      const qty = Number(returnQty[line.id] ?? 0);
      const refundable = Math.max(0, line.qty - line.alreadyRefundedQty);
      if (!Number.isInteger(qty) || qty < 0 || qty > refundable) {
        setLocalError(`Return quantity for ${line.name} must be between 0 and ${refundable}.`);
        return;
      }
      if (qty > 0) returns.push({ saleItemId: line.id, qty });
    }
    const replacements: Array<{ productId: string; qty: number }> = [];
    for (const product of products) {
      const qty = Number(replacementQty[product.id] ?? 0);
      if (!Number.isInteger(qty) || qty < 0) {
        setLocalError(`Replacement quantity for ${product.name} must be a whole number.`);
        return;
      }
      if (qty > 0) replacements.push({ productId: product.id, qty });
    }
    if (returns.length === 0) {
      setLocalError("Choose at least one item quantity to return.");
      return;
    }
    if (replacements.length === 0) {
      setLocalError("Choose at least one replacement item.");
      return;
    }
    if (reason.trim().length < 3) {
      setLocalError("Enter a short reason for the exchange.");
      return;
    }
    setLocalError("");
    onSubmit({ returns, replacements, reason: reason.trim() });
  }

  const visibleError = localError || error;
  const netLabel = preview.direction === "COLLECT"
    ? `Collect ₱${money(preview.netMinor)}`
    : preview.direction === "REFUND"
      ? `Refund ₱${money(Math.abs(preview.netMinor))}`
      : "Even exchange";

  return (
    <Modal
      open
      title="Exchange items"
      description="Return items from this completed cash sale and replace them at current catalog pricing."
      onClose={() => !busy && onClose()}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <GhostButton type="button" onClick={onClose} disabled={busy}>Cancel</GhostButton>
          <PrimaryButton type="submit" form="sale-exchange-form" disabled={busy}>
            {busy ? "Completing…" : "Complete exchange"}
          </PrimaryButton>
        </div>
      }
    >
      <form id="sale-exchange-form" noValidate onSubmit={submit} className="space-y-5">
        <div className="rounded-xl border border-[#f0e2d7] bg-[#fff8f3] p-4 text-[11px] leading-5 text-[#6d6057]">
          <strong>Cash-settled sale only.</strong> NexPOS records the return and replacement as linked gross transactions, while the register cash movements net to the customer difference shown below. Electronic-tender exchanges are not simulated.
        </div>

        <section className="space-y-3" aria-label="Items to return">
          <div>
            <h3 className="text-sm font-semibold text-[#2a241f]">1. Choose return quantities</h3>
            <p className="mt-1 text-[11px] text-[#8b8077]">Refund values come from the recorded sale lines, including historical discounts.</p>
          </div>
          {lines.map((line) => {
            const refundable = Math.max(0, line.qty - line.alreadyRefundedQty);
            return (
              <label key={line.id} className="grid gap-2 rounded-xl border border-[#eee4db] bg-white p-3 sm:grid-cols-[minmax(0,1fr)_120px] sm:items-end">
                <span>
                  <span className="block text-[12px] font-semibold text-[#2a241f]">{line.name}</span>
                  <span className="font-data mt-1 block text-[10px] text-[#8b8077]">Sold {line.qty} · refundable {refundable} · recorded value ₱{money(line.lineTotalMinor)}</span>
                </span>
                <span className="text-[10px] font-semibold text-[#655b53]">
                  Return qty
                  <input
                    type="number"
                    min={0}
                    max={refundable}
                    step={1}
                    value={returnQty[line.id] ?? ""}
                    onChange={(event) => setReturnQty((current) => ({ ...current, [line.id]: event.target.value }))}
                    disabled={busy || refundable === 0}
                    className="field mt-1.5"
                    placeholder="0"
                  />
                </span>
              </label>
            );
          })}
        </section>

        <section className="space-y-3" aria-label="Replacement products">
          <div>
            <h3 className="text-sm font-semibold text-[#2a241f]">2. Add replacement items</h3>
            <p className="mt-1 text-[11px] text-[#8b8077]">Replacement pricing uses the current active catalog and configured tax.</p>
          </div>
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Search replacement products
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              disabled={busy}
              className="field mt-1.5"
              placeholder="Product name, SKU or barcode"
            />
          </label>
          {productsLoading ? <p className="text-sm text-[#8b8077]">Loading products…</p> : null}
          {!productsLoading && products.length === 0 ? <p className="rounded-xl bg-[#f7f1ea] p-4 text-sm text-[#8b8077]">No active products match this search.</p> : null}
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {products.map((product) => (
              <label key={product.id} className="grid gap-2 rounded-xl border border-[#eee4db] bg-white p-3 sm:grid-cols-[minmax(0,1fr)_120px] sm:items-end">
                <span>
                  <span className="block text-[12px] font-semibold text-[#2a241f]">{product.name}</span>
                  <span className="font-data mt-1 block text-[10px] text-[#8b8077]">₱{money(product.priceMinor)} each{product.taxRateBps != null ? ` · ${(product.taxRateBps / 100).toFixed(2)}% tax` : ""}</span>
                </span>
                <span className="text-[10px] font-semibold text-[#655b53]">
                  Replacement qty
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={replacementQty[product.id] ?? ""}
                    onChange={(event) => setReplacementQty((current) => ({ ...current, [product.id]: event.target.value }))}
                    disabled={busy}
                    className="field mt-1.5"
                    placeholder="0"
                  />
                </span>
              </label>
            ))}
          </div>
        </section>

        <label className="block text-[11px] font-semibold text-[#655b53]">
          Reason for exchange
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            rows={3}
            className="field mt-1.5 resize-none"
            placeholder="Wrong size, wrong item, damaged item…"
          />
        </label>

        <section className="grid gap-3 rounded-xl bg-[#f7f1ea] p-4 text-[11px] sm:grid-cols-3" aria-label="Exchange preview">
          <div><span className="text-[#8b8077]">Return value</span><p className="font-data mt-1 font-semibold text-[#2a241f]">₱{money(preview.returnMinor)}</p></div>
          <div><span className="text-[#8b8077]">Replacement value</span><p className="font-data mt-1 font-semibold text-[#2a241f]">₱{money(preview.replacementMinor)}</p></div>
          <div className="sm:text-right"><span className="text-[#8b8077]">Net difference</span><p className="font-data mt-1 font-bold text-[#e44e34]">{netLabel}</p></div>
        </section>
        <p className="text-[10px] leading-4 text-[#94877d]">Preview uses the current catalog and tax settings. The server revalidates stock, refundable quantity, price, tax, open shift, and refund permissions before committing.</p>

        {visibleError ? <p role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{visibleError}</p> : null}
      </form>
    </Modal>
  );
}
