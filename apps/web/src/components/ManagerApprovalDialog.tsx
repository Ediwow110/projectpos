"use client";

import React, { useEffect, useRef, useState } from "react";
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
  | "shift.close.override"
  | "stored_value.adjust"
  | "loyalty.adjust";

export type ManagerApprovalAction =
  | { kind: "discount"; lines: Array<{ productId: string; qty: number; lineDiscountMinor: number }>; orderDiscountMinor: number }
  | { kind: "refund"; saleId: string; items: Array<{ saleItemId: string; qty: number }>; loadRefunds?: Array<{ loadId: string; amountMinor: number }>; reason?: string }
  | { kind: "sale_void"; saleId: string; reason: string }
  | { kind: "inventory_movement"; productId: string; movementType: string; qtyDelta: number; reason?: string; branchId?: string }
  | { kind: "inventory_count"; countId: string }
  | { kind: "shift_close"; shiftId: string; countedCashMinor: number; closeNotes?: string }
  | { kind: "value_adjustment"; valueType: "gift_card" | "store_credit" | "loyalty"; targetId: string; amountDelta: number; reason: string };

export interface ManagerApprovalGrant {
  token: string;
  expiresAt: string;
  approver: { id: string; name: string; role: string };
}

export function ManagerApprovalDialog({
  open,
  permission,
  action,
  registerId,
  queueEnabled = true,
  title = "Manager approval required",
  description,
  summary,
  onApproved,
  onClose,
}: {
  open: boolean;
  permission: ManagerApprovalPermission;
  action: ManagerApprovalAction;
  registerId?: string;
  queueEnabled?: boolean;
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
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueRequestId, setQueueRequestId] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState("");
  const [queueError, setQueueError] = useState("");
  const onApprovedRef = useRef(onApproved);
  const onCloseRef = useRef(onClose);
  // `busy` only disables the button after React re-renders, so two Enter
  // presses in the same tick could still mint two grants. A ref closes that
  // window without relying on render timing.
  const inFlightRef = useRef(false);

  useEffect(() => { onApprovedRef.current = onApproved; }, [onApproved]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (open) return;
    setEmail("");
    setPin("");
    setPassword("");
    setShowPassword(false);
    setError("");
    setQueueRequestId(null);
    setQueueStatus("");
    setQueueError("");
  }, [open]);

  async function requestManagerReview(): Promise<void> {
    const registerBound = ["discount", "shift_close", "refund", "sale_void"].includes(action.kind);
    const queueable = ["discount", "shift_close", "refund", "sale_void", "inventory_movement", "inventory_count", "value_adjustment"].includes(action.kind);
    if (queueBusy || !queueEnabled || !queueable || (registerBound && !registerId)) return;
    setQueueBusy(true);
    setQueueError("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const result = await apiFetch<{ request: { id: string } }>("/api/v1/approvals/requests", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ action, ...(registerId ? { registerId } : {}), idempotencyKey: crypto.randomUUID() }) },
      });
      setQueueRequestId(result.request.id);
      setQueueStatus("Request sent. Waiting for an authorized manager decision; the protected action has not been completed.");
    } catch (cause) {
      setQueueError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : "Could not send the request to the manager inbox.");
    } finally { setQueueBusy(false); }
  }

  useEffect(() => {
    if (!open || !queueRequestId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const result = await apiFetch<{ requests: Array<{ id: string; status: string; decisionReason: string | null }> }>("/api/v1/approvals/requests");
        const request = result.requests.find((item) => item.id === queueRequestId);
        if (!request) throw new Error("APPROVAL_REQUEST_UNAVAILABLE");
        if (request.status === "APPROVED") {
          const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
          const grant = await apiFetch<ManagerApprovalGrant>(`/api/v1/approvals/requests/${encodeURIComponent(queueRequestId)}/claim`, {
            csrfToken: csrf.csrfToken, init: { method: "POST" },
          });
          if (!stopped) {
            setQueueStatus("Manager approved this exact protected action. Resuming the requested action…");
            if (await onApprovedRef.current(grant)) onCloseRef.current();
          }
          return;
        }
        if (request.status === "REJECTED" || request.status === "EXPIRED") {
          if (!stopped) setQueueStatus(request.status === "REJECTED" ? `Manager declined this request${request.decisionReason ? `: ${request.decisionReason}` : ""}. The protected action was not completed.` : "This request expired before review. Submit a fresh request or use in-person approval.");
          return;
        }
        if (!stopped) timer = setTimeout(() => void poll(), 2500);
      } catch (cause) {
        if (!stopped) {
          setQueueError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : "Could not check the manager decision. No protected action was completed by this request.");
          timer = setTimeout(() => void poll(), 5000);
        }
      }
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [open, queueRequestId]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlightRef.current) return;
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
    inFlightRef.current = true;
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
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      variant="atlasFlow"
      title={title}
      description={description}
      onClose={() => !busy && onClose()}
      footer={<div className="flex flex-wrap justify-end gap-2"><GhostButton type="button" onClick={onClose} disabled={busy || queueBusy}>Cancel</GhostButton>{queueEnabled && ["discount", "shift_close", "refund", "sale_void", "inventory_movement", "inventory_count", "value_adjustment"].includes(action.kind) && (!["discount", "shift_close", "refund", "sale_void"].includes(action.kind) || Boolean(registerId)) && !queueRequestId && <GhostButton type="button" onClick={() => void requestManagerReview()} disabled={busy || queueBusy}>{queueBusy ? "Sending…" : "Send to manager inbox"}</GhostButton>}<PrimaryButton type="submit" form="manager-approval-form" className="!bg-[#202826] !shadow-none hover:!bg-[#36443c]" disabled={busy || queueBusy}>{busy ? "Verifying…" : "Approve & continue"}</PrimaryButton></div>}
    >
      <form id="manager-approval-form" noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="rounded-xl border border-[#f0e2d7] bg-[#fff8f3] p-4 text-[11px] leading-5 text-[#6d6057]">
          An active owner or manager authorizes this exact action. The approval is short-lived and one-use; credentials are never saved in browser storage.
        </div>
        {summary ? <div className="rounded-xl bg-[#f7f1ea] p-3 text-[12px] text-[#4e453e]">{summary}</div> : null}
        {queueStatus ? <p role="status" className="rounded-xl border border-[#dce7df] bg-[#f3f8f4] px-3 py-2.5 text-[12px] leading-5 text-[#42604d]">{queueStatus}</p> : null}
        {queueError ? <p role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#a34132]">{queueError}</p> : null}
        <label className="block text-[11px] font-semibold text-[#655b53]">Manager email<input autoFocus type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} className="field mt-1.5 !border-[#e4e9e3] !bg-[#eff2ed]" placeholder="manager@example.com" /></label>
        {mode === "pin" ? (
          <label className="block text-[11px] font-semibold text-[#655b53]">Approval PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} className="field font-data mt-1.5 tracking-[0.35em]" placeholder="••••••" /></label>
        ) : (
          <label className="block text-[11px] font-semibold text-[#655b53]">Manager password<span className="mt-1.5 flex gap-2"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} className="field min-w-0 flex-1" placeholder="Password" /><GhostButton type="button" disabled={busy} aria-pressed={showPassword} aria-label={showPassword ? "Hide manager password" : "Show manager password"} onClick={() => setShowPassword((current) => !current)} className="shrink-0">{showPassword ? "Hide" : "Show"}</GhostButton></span></label>
        )}
        <button type="button" disabled={busy} onClick={() => { setMode((current) => current === "pin" ? "password" : "pin"); setError(""); }} className="text-[11px] font-semibold text-[var(--color-atlas-accent-strong)] hover:text-[#b93d28] disabled:opacity-50">{mode === "pin" ? "Use password instead" : "Use approval PIN instead"}</button>
        {error ? <p role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
      </form>
    </Modal>
  );
}
