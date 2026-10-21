"use client";

import { useState } from "react";
import type { JSX } from "react";

import { apiFetch } from "../lib/api";
import { errorText } from "../lib/billing";
import { formatMoneyMinor } from "../lib/money";
import {
  canApplyValueAdjustment,
  canChangeCardStatus,
  nextCardStatus,
  parseGiftCardAdjust,
  type GiftCardAdjustInput,
} from "../lib/gift-card-value";
import { ManagerApprovalDialog, type ManagerApprovalGrant } from "./ManagerApprovalDialog";
import { Panel, SectionHeader } from "./premium";

interface PendingAdjustment extends GiftCardAdjustInput {
  idempotencyKey: string;
}

export interface GiftCardValueControlsProps {
  cardId: string;
  status: string;
  balanceMinor: number;
  permissions: readonly string[];
  role: string;
  onChanged: () => void;
}

export function GiftCardValueControls({
  cardId,
  status,
  balanceMinor,
  permissions,
  role,
  onChanged,
}: GiftCardValueControlsProps): JSX.Element {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [pending, setPending] = useState<PendingAdjustment | null>(null);

  const canApply = canApplyValueAdjustment(permissions);
  const canRequest = !canApply && role === "cashier";
  const canManageStatus = canChangeCardStatus(permissions);
  const target = nextCardStatus(status);

  async function postAdjust(request: PendingAdjustment, approvalToken?: string): Promise<boolean> {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/gift-cards/${cardId}/adjust`, {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          headers: { "Idempotency-Key": request.idempotencyKey },
          body: JSON.stringify({
            amountMinor: request.amountMinor,
            reason: request.reason,
            ...(approvalToken ? { approvalToken } : {}),
          }),
        },
      });
      setAmount("");
      setReason("");
      setPending(null);
      setApprovalOpen(false);
      setSuccess(`Balance adjusted by ${formatMoneyMinor(request.amountMinor)}.`);
      onChanged();
      return true;
    } catch (cause) {
      setError(errorText(cause, "The adjustment was not recorded."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function beginAdjust(): void {
    const parsed = parseGiftCardAdjust(amount, reason);
    if ("fieldError" in parsed) {
      setFieldError(parsed.fieldError);
      return;
    }
    setFieldError("");
    const request = { ...parsed.ok, idempotencyKey: crypto.randomUUID() };
    if (canRequest) {
      setPending(request);
      setApprovalOpen(true);
      return;
    }
    void postAdjust(request);
  }

  async function applyApprovedAdjust(grant: ManagerApprovalGrant): Promise<boolean> {
    if (!pending) {
      setError("The pending adjustment details are unavailable. Reopen the request before continuing.");
      return true;
    }
    // A grant is one-use: close the dialog even if the adjustment itself fails,
    // so the reviewer sees the error instead of silently re-spending it.
    await postAdjust(pending, grant.token);
    setApprovalOpen(false);
    return true;
  }

  async function changeStatus(): Promise<void> {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/gift-cards/${cardId}/status`, {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ status: target, reason: statusReason.trim() }) },
      });
      setStatusReason("");
      setSuccess(`Card marked ${target}.`);
      onChanged();
    } catch (cause) {
      setError(errorText(cause, "The status change was not recorded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5">
      <SectionHeader
        title="Manage this card"
        description="Adjustments and status changes append to the card's ledger; history is never rewritten."
      />
      {success ? (
        <p role="status" className="mt-4 text-sm font-medium text-[var(--color-atlas-verified)]">{success}</p>
      ) : null}
      {error ? <p role="alert" className="mt-4 text-sm font-medium text-[#c43e3e]">{error}</p> : null}

      {canApply || canRequest ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)_auto]">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">Adjustment (pesos)</span>
            <input
              data-ui="gift-card-adjust-amount"
              className="mt-1 min-h-11 w-full rounded-xl border border-[#e4d9d0] bg-white px-3 font-data text-sm"
              inputMode="decimal"
              placeholder="-25.50"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">Reason</span>
            <input
              data-ui="gift-card-adjust-reason"
              className="mt-1 min-h-11 w-full rounded-xl border border-[#e4d9d0] bg-white px-3 text-sm"
              maxLength={500}
              placeholder="Refunded to card after dispute"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            data-ui="gift-card-adjust-submit"
            disabled={busy}
            onClick={beginAdjust}
            className="min-h-11 self-end rounded-xl bg-[#2a241f] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Saving…" : canRequest ? "Request manager review" : "Apply adjustment"}
          </button>
          {fieldError ? <p role="alert" className="text-sm font-medium text-[var(--color-atlas-warning-strong)] sm:col-span-3">{fieldError}</p> : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-atlas-muted-strong)]">
          Adjusting this balance requires a manager approval or the stored-value grant, and this session holds neither.
        </p>
      )}

      {canManageStatus ? (
        <div className="mt-5 grid gap-3 border-t border-[#eee4db] pt-5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">Reason for the status change</span>
            <input
              data-ui="gift-card-status-reason"
              className="mt-1 min-h-11 w-full rounded-xl border border-[#e4d9d0] bg-white px-3 text-sm"
              maxLength={500}
              placeholder="Reported lost by the holder"
              value={statusReason}
              onChange={(event) => setStatusReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            data-ui="gift-card-status-submit"
            disabled={busy}
            onClick={() => void changeStatus()}
            className="min-h-11 self-end rounded-xl border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f] disabled:opacity-60"
          >
            {target === "SUSPENDED" ? "Suspend card" : "Activate card"}
          </button>
          <p className="text-[11px] text-[var(--color-atlas-muted-strong)] sm:col-span-2">
            Current balance {formatMoneyMinor(balanceMinor)} · a suspended card stops accepting loads and spend.
          </p>
        </div>
      ) : null}

      <ManagerApprovalDialog
        open={approvalOpen}
        permission="stored_value.adjust"
        action={{
          kind: "value_adjustment",
          valueType: "gift_card",
          targetId: cardId,
          amountDelta: pending?.amountMinor ?? 1,
          reason: pending?.reason ?? "Pending gift-card adjustment",
        }}
        queueEnabled={canRequest}
        title="Manager approval · gift-card adjustment"
        description="An authorized manager must approve this exact card balance change. Approval is one-use and does not move the ledger until the request resumes."
        summary={pending ? `${pending.amountMinor} · ${pending.reason}` : undefined}
        onApproved={applyApprovedAdjust}
        onClose={() => {
          setApprovalOpen(false);
          setPending(null);
        }}
      />
    </Panel>
  );
}
