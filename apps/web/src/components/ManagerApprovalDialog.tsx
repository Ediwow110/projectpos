"use client";

import React, { useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";

import { ApiError, apiFetch } from "../lib/api";
import { Modal } from "./Modal";
import { GhostButton, PrimaryButton } from "./ui";

export type ManagerApprovalPermission =
  | "discount.override"
  | "sale.refund"
  | "refund.override"
  | "sale.void"
  | "inventory.adjust"
  | "shift.close.override";

export type ManagerApprovalAction =
  | { kind: "discount"; lines: Array<{ productId: string; qty: number; lineDiscountMinor: number }>; orderDiscountMinor: number }
  | { kind: "refund"; saleId: string; items: Array<{ saleItemId: string; qty: number }>; reason?: string }
  | { kind: "sale_void"; saleId: string; reason: string }
  | { kind: "inventory_movement"; productId: string; movementType: string; qtyDelta: number; reason?: string; branchId?: string }
  | { kind: "shift_close"; shiftId: string; countedCashMinor: number; closeNotes?: string };

export interface ManagerApprovalGrant {
  token: string;
  expiresAt: string;
  approver: { id: string; name: string; role: string };
}

export function ManagerApprovalDialog({
  open,
  permission,
  action,
  title = "Manager approval required",
  description,
  summary,
  onApproved,
  onClose,
}: {
  open: boolean;
  permission: ManagerApprovalPermission;
  action: ManagerApprovalAction;
  title?: string;
  description: string;
  summary?: JSX.Element | string;
  onApproved: (grant: ManagerApprovalGrant) => Promise<boolean>;
  onClose: () => void;
}): JSX.Element | null {
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setEmail("");
    setPin("");
    setPassword("");
    setShowPassword(false);
    setError("");
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes("@")) {
      setError("Enter the owner or manager email address.");
      return;
    }
    if (mode === "pin" && !/^\d{6}$/.test(pin)) {
      setError("Enter the six-digit owner or manager approval PIN.");
      return;
    }
    if (mode === "password" && !password) {
      setError("Enter the owner or manager password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const grant = await apiFetch<ManagerApprovalGrant>("/api/v1/approvals/manager", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            email: cleanEmail,
            permission,
            action,
            ...(mode === "pin" ? { pin } : { password }),
          }),
        },
      });
      if (await onApproved(grant)) onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "AUTH_INVALID_CREDENTIALS") {
        setError("Manager credentials could not be verified. Use an active owner or manager account for this business.");
      } else if (cause instanceof ApiError && cause.code === "RATE_LIMITED") {
        setError("Too many approval attempts. Try again shortly.");
      } else {
        setError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : "Could not verify manager approval.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={() => !busy && onClose()}
      footer={<div className="flex flex-wrap justify-end gap-2"><GhostButton type="button" onClick={onClose} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="manager-approval-form" disabled={busy}>{busy ? "Verifying…" : "Approve & continue"}</PrimaryButton></div>}
    >
      <form id="manager-approval-form" noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="rounded-xl border border-[#f0e2d7] bg-[#fff8f3] p-4 text-[11px] leading-5 text-[#6d6057]">
          An active owner or manager authorizes this exact action. The approval is short-lived and one-use; credentials are never saved in browser storage.
        </div>
        {summary ? <div className="rounded-xl bg-[#f7f1ea] p-3 text-[12px] text-[#4e453e]">{summary}</div> : null}
        <label className="block text-[11px] font-semibold text-[#655b53]">Manager email<input autoFocus type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} className="field mt-1.5" placeholder="manager@example.com" /></label>
        {mode === "pin" ? (
          <label className="block text-[11px] font-semibold text-[#655b53]">Approval PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} className="field font-data mt-1.5 tracking-[0.35em]" placeholder="••••••" /></label>
        ) : (
          <label className="block text-[11px] font-semibold text-[#655b53]">Manager password<span className="mt-1.5 flex gap-2"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} className="field min-w-0 flex-1" placeholder="Password" /><GhostButton type="button" disabled={busy} aria-pressed={showPassword} aria-label={showPassword ? "Hide manager password" : "Show manager password"} onClick={() => setShowPassword((current) => !current)} className="shrink-0">{showPassword ? "Hide" : "Show"}</GhostButton></span></label>
        )}
        <button type="button" disabled={busy} onClick={() => { setMode((current) => current === "pin" ? "password" : "pin"); setError(""); }} className="text-[11px] font-semibold text-[#d94a30] hover:text-[#b93d28] disabled:opacity-50">{mode === "pin" ? "Use password instead" : "Use approval PIN instead"}</button>
        {error ? <p role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
      </form>
    </Modal>
  );
}
