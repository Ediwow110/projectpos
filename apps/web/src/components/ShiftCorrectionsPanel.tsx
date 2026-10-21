"use client";

import { useState } from "react";
import type { JSX } from "react";

import { apiFetch } from "../lib/api";
import { errorText } from "../lib/billing";
import { canRecordCorrection, parseCorrection, type CorrectionRow } from "../lib/shift-corrections";
import { minorToMajorFixed } from "../lib/money";
import { Panel, SectionHeader } from "./premium";

export interface ShiftCorrectionsPanelProps {
  shiftId: string;
  status: string;
  corrections: readonly CorrectionRow[];
  correctedExpectedCashMinor: number | null;
  permissions: readonly string[];
  onRecorded: () => void;
}

function CorrectionForm({ shiftId, onRecorded }: { shiftId: string; onRecorded: () => void }): JSX.Element {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const parsed = parseCorrection(amount, reason);
    if ("fieldError" in parsed) {
      setFieldError(parsed.fieldError);
      return;
    }
    setFieldError("");
    setError("");
    setBusy(true);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/shifts/${shiftId}/corrections`, {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify(parsed.ok) },
      });
      setAmount("");
      setReason("");
      onRecorded();
    } catch (e) {
      setError(errorText(e, "The correction was not recorded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form data-ui="shift-correction-form" className="mt-4 space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">Amount (pesos)</span>
          <input
            data-ui="shift-correction-amount"
            className="mt-1 min-h-11 w-full rounded-xl border border-[#e4d9d0] bg-white px-3 font-data text-sm"
            inputMode="decimal"
            placeholder="-45.30"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">Reason for the correction</span>
          <input
            data-ui="shift-correction-reason"
            className="mt-1 min-h-11 w-full rounded-xl border border-[#e4d9d0] bg-white px-3 text-sm"
            maxLength={200}
            placeholder="Counted float short after till audit"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>
      {fieldError ? <p role="alert" className="text-sm font-medium text-[var(--color-atlas-warning-strong)]">{fieldError}</p> : null}
      {error ? <p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p> : null}
      <button
        data-ui="shift-correction-submit"
        type="submit"
        disabled={busy}
        className="min-h-11 rounded-xl bg-[#2a241f] px-4 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Recording…" : "Record correction"}
      </button>
      <p className="text-[11px] text-[var(--color-atlas-muted-strong)]">
        The closed shift stays immutable. This is appended to its audit trail and moves the expected cash only.
      </p>
    </form>
  );
}

export function ShiftCorrectionsPanel({
  shiftId,
  status,
  corrections,
  correctedExpectedCashMinor,
  permissions,
  onRecorded,
}: ShiftCorrectionsPanelProps): JSX.Element {
  const canRecord = canRecordCorrection(permissions, status);
  return (
    <Panel className="p-5">
      <SectionHeader
        title="Corrections"
        description="Audited explanations for a closed shift's variance. The original record is never edited."
      />
      {corrections.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-atlas-muted-strong)]">No corrections recorded.</p>
      ) : (
        <table className="premium-table mt-4 min-w-[620px] text-left text-[12px]">
          <caption className="sr-only">Recorded shift corrections</caption>
          <thead>
            <tr><th className="px-4 pb-3">Reason</th><th className="px-4 pb-3">Recorded by</th><th className="px-4 pb-3 text-right">Amount</th></tr>
          </thead>
          <tbody>
            {corrections.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 text-[#2a241f]">{row.reason}</td>
                <td className="font-data px-4 py-3 text-[var(--color-atlas-muted-strong)]">{row.actorId.slice(0, 8)}</td>
                <td className="font-data px-4 py-3 text-right font-semibold">{minorToMajorFixed(row.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {correctedExpectedCashMinor !== null ? (
        <p className="font-data mt-4 text-sm font-semibold text-[#2a241f]">
          Corrected expected cash {minorToMajorFixed(correctedExpectedCashMinor)}
        </p>
      ) : null}
      {canRecord ? <CorrectionForm shiftId={shiftId} onRecorded={onRecorded} /> : null}
    </Panel>
  );
}
