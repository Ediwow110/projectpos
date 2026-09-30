"use client";

import React, { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Modal } from "./Modal";
import { GhostButton, PrimaryButton } from "./ui";

function money(minor: number): string {
  return (minor / 100).toFixed(2);
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
  onApprove: (input: { email: string; password: string }) => void;
  onClose: () => void;
}): JSX.Element {
  const [email, setEmail] = useState("");
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
    if (!password) {
      setLocalError("Enter the owner or manager password.");
      return;
    }
    setLocalError("");
    onApprove({ email: cleanEmail, password });
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
          An active owner or manager can authorize this exact discounted sale with their NexPOS account credentials. The approval is short-lived and one-use. The password is not saved in browser storage.
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

        {visibleError ? (
          <p role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">
            {visibleError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
