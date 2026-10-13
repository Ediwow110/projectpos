"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, SectionHeader } from "./premium";
import { PrimaryButton, StatusPill } from "./ui";
import { apiFetch } from "../lib/api";
import { errorText } from "../lib/billing";

interface BusinessSettings {
  settings: { refundApprovalThresholdMinor?: number };
}

export function OwnerFinancialPolicies(): React.JSX.Element {
  const [amount, setAmount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const business = useQuery({
    queryKey: ["owner-business-settings"],
    queryFn: () => apiFetch<BusinessSettings>("/api/v1/business"),
    retry: false,
  });
  const threshold = business.data?.settings.refundApprovalThresholdMinor;

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const pesos = Number(amount);
    const minor = Math.round(pesos * 100);
    if (!amount.trim() || !Number.isFinite(pesos) || pesos < 0 ||
        !Number.isSafeInteger(minor) || minor > 100_000_000 ||
        Math.abs(minor / 100 - pesos) > 1e-8) {
      setError("Enter a valid amount in PHP, up to ₱1,000,000, with at most two decimal places.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const { csrfToken } = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/auth/confirm-password", {
        csrfToken,
        init: { method: "POST", body: JSON.stringify({ password }) },
      });
      await apiFetch("/api/v1/business/settings", {
        csrfToken,
        init: { method: "PATCH", body: JSON.stringify({ refundApprovalThresholdMinor: minor }) },
      });
      await business.refetch();
      setSuccess("Owner refund approval threshold saved. Existing refund policies remain in force.");
      setAmount("");
    } catch (cause) {
      setError(errorText(cause, "Could not save refund policy."));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5">
      <SectionHeader
        title="Financial approval policies"
        description="Configure the existing refund approval threshold. Other financial controls require separate policy-engine work."
      />
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-[#f7f8f5] p-4">
        <StatusPill tone={threshold === undefined ? "warn" : "ok"}>
          {threshold === undefined ? "Default policy" : "Configured"}
        </StatusPill>
        <span className="text-sm text-[#202826]">
          {business.isLoading ? "Loading policy…" : threshold === undefined
            ? "No additional owner-only amount threshold is configured"
            : `Refunds above ₱${(threshold / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })} require owner approval`}
        </span>
      </div>
      {business.isError ? (
        <p role="alert" className="mt-3 text-sm text-[#b74945]">Unable to load the current business policy. Changes are disabled.</p>
      ) : null}
      <form onSubmit={(event) => void save(event)} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block text-sm font-medium text-[#202826]">
          Owner approval above (PHP)
          <input className="field mt-1.5" type="number" inputMode="decimal" min={0} max={1000000} step="0.01"
            required placeholder={threshold === undefined ? "e.g. 2000.00" : (threshold / 100).toFixed(2)}
            value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-[#202826]">
          Owner password
          <input className="field mt-1.5" type="password" autoComplete="current-password"
            required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <PrimaryButton type="submit" disabled={busy || business.isLoading || business.isError}>
          {busy ? "Saving…" : "Save threshold"}
        </PrimaryButton>
      </form>
      {error ? <p role="alert" className="mt-3 text-sm text-[#b74945]">{error}</p> : null}
      {success ? <p role="status" className="mt-3 text-sm text-[#267552]">{success}</p> : null}
      <p className="mt-4 text-xs leading-5 text-[#707b75]">
        This updates the existing refund threshold, not discount or void approval rules.
        Set to ₱0.00 to require owner approval for positive-value refunds.
      </p>
    </Panel>
  );
}
