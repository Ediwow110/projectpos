"use client";

import React, { useState } from "react";

import { apiFetch, ApiError } from "../lib/api";
import { formatMoneyMinor } from "../lib/money";
import { parseMajorCurrencyToMinor, type PosGiftCardLoad } from "../lib/pos-sale-model";
import { Modal } from "./Modal";
import { GhostButton, PrimaryButton } from "./ui";

interface GiftCardLookup {
  id: string;
  maskedCode: string;
  status: string;
  balanceMinor: number;
}

function money(minor: number): string {
  return formatMoneyMinor(minor);
}

export function GiftCardLoadDialog({
  onSave,
  onClose,
}: {
  onSave: (load: PosGiftCardLoad) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<"NEW" | "RELOAD">("NEW");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<GiftCardLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const amountMinor = parseMajorCurrencyToMinor(amount);
  const blockedStatus = lookup && ["VOID", "SUSPENDED"].includes(lookup.status);

  async function resolveCard(): Promise<void> {
    const raw = code.trim();
    if (!raw) {
      setError("Enter or scan the gift-card bearer code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<GiftCardLookup>(`/api/v1/gift-cards/lookup?code=${encodeURIComponent(raw)}`);
      setLookup(result);
      setCode("");
    } catch (err) {
      setLookup(null);
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Gift-card lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  function selectKind(next: "NEW" | "RELOAD"): void {
    setKind(next);
    setLookup(null);
    setCode("");
    setError("");
  }

  function save(): void {
    if (!amountMinor) {
      setError("Enter a positive amount up to two decimal places.");
      return;
    }
    if (kind === "RELOAD") {
      if (!lookup) {
        setError("Resolve the existing gift card before continuing.");
        return;
      }
      if (blockedStatus) {
        setError(`Gift card status ${lookup.status} cannot be reloaded.`);
        return;
      }
      onSave({ kind, amountMinor, giftCardId: lookup.id, maskedCode: lookup.maskedCode, previousBalanceMinor: lookup.balanceMinor, status: lookup.status });
      return;
    }
    onSave({ kind, amountMinor });
  }

  return (
    <Modal
      open
      title="Load a gift card"
      description="Gift-card loads are online-only and are funded with a normal external tender at payment."
      onClose={onClose}
      footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={onClose} disabled={busy}>Cancel</GhostButton><PrimaryButton type="button" onClick={save} disabled={busy || !amountMinor || (kind === "RELOAD" && (!lookup || Boolean(blockedStatus)))}>Add load</PrimaryButton></div>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Gift-card load type">
          <button type="button" onClick={() => selectKind("NEW")} aria-pressed={kind === "NEW"} className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${kind === "NEW" ? "border-[#f35d3f] bg-[#fff0ea] text-[#c43e3e]" : "border-[#eee4db] bg-white text-[#655b53]"}`}>New gift card<span className="mt-1 block text-[11px] font-normal text-[#8b8077]">Issue on completion</span></button>
          <button type="button" onClick={() => selectKind("RELOAD")} aria-pressed={kind === "RELOAD"} className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${kind === "RELOAD" ? "border-[#f35d3f] bg-[#fff0ea] text-[#c43e3e]" : "border-[#eee4db] bg-white text-[#655b53]"}`}>Reload card<span className="mt-1 block text-[11px] font-normal text-[#8b8077]">Use an existing card</span></button>
        </div>

        {kind === "RELOAD" ? (
          <div className="space-y-2 rounded-xl border border-[#eee4db] bg-[#fcf8f3] p-4">
            <label className="block text-[11px] font-semibold text-[#655b53]">Gift-card bearer code
              <input value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void resolveCard(); }} className="field mt-1.5" placeholder="Scan or enter code" aria-describedby="gift-card-code-help" autoComplete="off" />
            </label>
            <p id="gift-card-code-help" className="text-[10px] text-[#8b8077]">The code is used only for secure lookup and is cleared after resolution.</p>
            <GhostButton type="button" onClick={() => void resolveCard()} disabled={busy || !code.trim()}>{busy ? "Looking up…" : "Resolve card"}</GhostButton>
            {lookup ? <div className="rounded-lg border border-[#cfe9dc] bg-[#eaf7f0] p-3 text-[11px] text-[#1f8a5b]"><p className="font-semibold">{lookup.maskedCode} · {lookup.status}</p><p className="mt-1">Current balance ₱{money(lookup.balanceMinor)}</p></div> : null}
          </div>
        ) : <p className="rounded-xl bg-[#fcf8f3] p-4 text-[11px] leading-5 text-[#73685f]">A new active card and its one-time bearer code are created only after the sale completes successfully.</p>}

        <label className="block text-[11px] font-semibold text-[#655b53]">Load amount (PHP)
          <input value={amount} onChange={(event) => setAmount(event.target.value)} className="field mt-1.5" placeholder="10.00" inputMode="decimal" aria-describedby="gift-card-amount-help" />
        </label>
        <p id="gift-card-amount-help" className="text-[10px] text-[#8b8077]">The load is separate from merchandise and does not earn loyalty points or affect inventory.</p>
        {error ? <p role="alert" className="rounded-lg border border-[#efb9b9] bg-[#fff0f0] px-3 py-2 text-[11px] font-medium text-[#c43e3e]">{error}</p> : null}
      </div>
    </Modal>
  );
}

