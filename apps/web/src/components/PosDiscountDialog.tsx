"use client";

import React, { useMemo, useState } from "react";
import type { FormEvent, JSX } from "react";

import {
  applyCartDiscounts,
  posDiscountSummary,
  type PosCartEntry,
} from "../lib/pos-sale-model";
import { minorToMajorFixed } from "../lib/money";
import { Modal } from "./Modal";
import { GhostButton, PrimaryButton } from "./ui";

function phpInput(minor: number): string {
  return minorToMajorFixed(minor);
}

function parsePhp(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  if (!/^\d+(?:\.\d{0,2})?$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
}

export interface PosDiscountInput {
  orderDiscountMinor: number;
  lineDiscounts: Record<string, number>;
}

export function PosDiscountDialog({
  cart,
  orderDiscountMinor,
  onApply,
  onClose,
}: {
  cart: PosCartEntry[];
  orderDiscountMinor: number;
  onApply: (input: PosDiscountInput) => void;
  onClose: () => void;
}): JSX.Element {
  const [orderValue, setOrderValue] = useState(() => phpInput(orderDiscountMinor));
  const [lineValues, setLineValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(cart.map((entry) => [entry.productId, phpInput(entry.lineDiscountMinor)])),
  );
  const [error, setError] = useState("");

  const preview = useMemo(() => {
    const parsedLines: Record<string, number> = {};
    for (const entry of cart) {
      const value = parsePhp(lineValues[entry.productId] ?? "0");
      parsedLines[entry.productId] = value ?? 0;
    }
    const nextCart = applyCartDiscounts(cart, parsedLines);
    return posDiscountSummary(nextCart, parsePhp(orderValue) ?? 0);
  }, [cart, lineValues, orderValue]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsedOrder = parsePhp(orderValue);
    if (parsedOrder === null) {
      setError("Enter the order discount as a valid PHP amount with up to two decimal places.");
      return;
    }
    const lineDiscounts: Record<string, number> = {};
    let subtotalAfterLines = 0;
    for (const entry of cart) {
      const parsed = parsePhp(lineValues[entry.productId] ?? "0");
      if (parsed === null) {
        setError(`Enter a valid line discount for ${entry.name}.`);
        return;
      }
      const gross = entry.qty * entry.priceMinor;
      if (parsed > gross) {
        setError(`Line discount for ${entry.name} cannot exceed ₱${phpInput(gross)}.`);
        return;
      }
      lineDiscounts[entry.productId] = parsed;
      subtotalAfterLines += gross - parsed;
    }
    if (parsedOrder > subtotalAfterLines) {
      setError(`Order discount cannot exceed ₱${phpInput(subtotalAfterLines)} after line discounts.`);
      return;
    }
    if (cart.length > 0 && subtotalAfterLines - parsedOrder <= 0) {
      setError("Discounts must leave at least ₱0.01 to complete this sale.");
      return;
    }
    setError("");
    onApply({ orderDiscountMinor: parsedOrder, lineDiscounts });
  }

  function clearAll(): void {
    onApply({
      orderDiscountMinor: 0,
      lineDiscounts: Object.fromEntries(cart.map((entry) => [entry.productId, 0])),
    });
  }

  return (
    <Modal
      open
      title="Sale discounts"
      description="Apply fixed PHP discounts before holding or paying this sale. Server authorization remains authoritative."
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <GhostButton type="button" onClick={clearAll}>Clear all</GhostButton>
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" form="pos-discount-form">Apply discounts</PrimaryButton>
        </div>
      }
    >
      <form id="pos-discount-form" noValidate onSubmit={submit} className="space-y-5">
        <div className="rounded-xl border border-[#f0e2d7] bg-[#fff8f3] p-4 text-[11px] leading-5 text-[#6d6057]">
          Discounts above your business&apos;s <strong>configured approval limits</strong> require
          <code className="mx-1 rounded bg-white px-1.5 py-0.5 font-data text-[10px] text-[#b94832]">discount.override</code>.
          Cashiers can request an owner or manager approval in context when the sale is held or paid.
        </div>

        <label className="block text-[11px] font-semibold text-[#655b53]">
          Order discount (PHP)
          <input
            value={orderValue}
            onChange={(event) => setOrderValue(event.target.value)}
            inputMode="decimal"
            className="field font-data mt-1.5"
            placeholder="0.00"
          />
        </label>

        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-semibold text-[#655b53]">Line discounts</p>
            <p className="mt-1 text-[10px] text-[#94877d]">Use fixed PHP amounts per cart line.</p>
          </div>
          {cart.map((entry) => (
            <label key={entry.productId} className="grid gap-2 rounded-xl border border-[#eee4db] bg-white p-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold text-[#2a241f]">{entry.name}</span>
                <span className="font-data mt-1 block text-[10px] text-[#8b8077]">{entry.qty} × ₱{phpInput(entry.priceMinor)} · max ₱{phpInput(entry.qty * entry.priceMinor)}</span>
              </span>
              <span className="text-[10px] font-semibold text-[#655b53]">
                Line discount — {entry.name} (PHP)
                <input
                  value={lineValues[entry.productId] ?? "0.00"}
                  onChange={(event) => setLineValues((current) => ({ ...current, [entry.productId]: event.target.value }))}
                  inputMode="decimal"
                  className="field font-data mt-1.5"
                  placeholder="0.00"
                />
              </span>
            </label>
          ))}
        </div>

        <div className="grid gap-2 rounded-xl bg-[#f7f1ea] p-4 text-[11px] sm:grid-cols-3">
          <div><span className="text-[#8b8077]">Gross</span><p className="font-data mt-1 font-semibold text-[#2a241f]">₱{phpInput(preview.grossMinor)}</p></div>
          <div><span className="text-[#8b8077]">Discounts</span><p className="font-data mt-1 font-semibold text-[#c94f37]">−₱{phpInput(preview.totalDiscountMinor)}</p></div>
          <div className="sm:text-right"><span className="text-[#8b8077]">Preview total</span><p className="font-data mt-1 font-bold text-[#2a241f]">₱{phpInput(preview.totalMinor)}</p></div>
        </div>

        {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
      </form>
    </Modal>
  );
}
