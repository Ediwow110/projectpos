"use client";

import React, { useState } from "react";
import type { FormEvent, JSX } from "react";

import { minorToMajorFixed } from "../lib/money";
import { Modal } from "./Modal";
import { GhostButton, PrimaryButton } from "./ui";

function money(minor: number): string {
  return minorToMajorFixed(minor);
}

export function PosManagerApprovalDialog({
  action,
  discountMinor,
  busy,
  error,
  onApprove,
  onClose,
}: {
  action: "pay" | "hold";
  discountMinor: number;
  busy: boolean;
  error: string;
  onApprove: (input: { email: string; pin?: string; password?: string }) => void;
  onClose: () => void;
}): JSX.Element {
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes("@")) {
      setLocalError("Enter the owner or manager email address.");
      return;
    }
    if (mode === "pin" && !/^\d{6}$/.test(pin)) {
      setLocalError("Enter the six-digit owner or manager approval PIN.");
      return;
    }
    if (mode === "password" && !password) {
      setLocalError("Enter the owner or manager password.");
      return;
    }
    setLocalError("");
    onApprove(mode === "pin" ? { email: cleanEmail, pin } : { email: cleanEmail, password });
  }

  const visibleError = localError || error;
  return (
    <Modal
      open
      title="Manager approval"
      description={`This ${action === "pay" ? "payment" : "hold"} includes ₱${money(discountMinor)} in discounts above the cashier threshold.`}
      onClose={() => !busy && onClose()}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <GhostButton type="button" onClick={onClose} disabled={busy}>Cancel</GhostButton>
          <PrimaryButton type="submit" form="pos-manager-approval-form" disabled={busy}>
            {busy ? "Verifying…" : "Approve & continue"}
          </PrimaryButton>
        </div>
      }
    >
      <form id="pos-manager-approval-form" noValidate onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-[#f0e2d7] bg-[#fff8f3] p-4 text-[11px] leading-5 text-[#6d6057]">
          An active owner or manager can authorize this exact discounted sale with their six-digit staff approval PIN. The approval is short-lived and one-use. PINs and passwords are never saved in browser storage.
        </div>

        <label className="block text-[11px] font-semibold text-[#655b53]">
          Manager email
          <input
            autoFocus
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            className="field mt-1.5"
            placeholder="manager@example.com"
          />
        </label>

        {mode === "pin" ? (
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Approval PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={busy}
              className="field font-data mt-1.5 tracking-[0.35em]"
              placeholder="••••••"
            />
          </label>
        ) : (
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Manager password
            <span className="mt-1.5 flex gap-2">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                className="field min-w-0 flex-1"
                placeholder="Password"
              />
              <GhostButton
                type="button"
                disabled={busy}
                aria-pressed={showPassword}
                aria-label={showPassword ? "Hide manager password" : "Show manager password"}
                onClick={() => setShowPassword((current) => !current)}
                className="shrink-0"
              >
                {showPassword ? "Hide" : "Show"}
              </GhostButton>
            </span>
          </label>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => { setMode((current) => current === "pin" ? "password" : "pin"); setLocalError(""); }}
          className="text-[11px] font-semibold text-[#d94a30] hover:text-[#b93d28] disabled:opacity-50"
        >
          {mode === "pin" ? "Use password instead" : "Use approval PIN instead"}
        </button>

        {visibleError ? (
          <p role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">
            {visibleError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
