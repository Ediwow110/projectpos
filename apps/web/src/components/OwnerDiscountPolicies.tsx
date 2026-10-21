"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, SectionHeader } from "./premium";
import { PrimaryButton } from "./ui";
import { apiFetch } from "../lib/api";
import { errorText } from "../lib/billing";

interface DiscountSettings {
  settings: { orderDiscountApprovalPercent?: number; lineDiscountApprovalPercent?: number };
}

export function OwnerDiscountPolicies(): React.JSX.Element {
  const [orderLimit, setOrderLimit] = useState("10");
  const [lineLimit, setLineLimit] = useState("20");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [initialized, setInitialized] = useState(false);
  const business = useQuery({
    queryKey: ["owner-business-discount-settings"],
    queryFn: () => apiFetch<DiscountSettings>("/api/v1/business"),
    retry: false,
  });
  const settings = business.data?.settings;
  useEffect(() => {
    if (!settings || initialized) return;
    setOrderLimit(String(settings.orderDiscountApprovalPercent ?? 10));
    setLineLimit(String(settings.lineDiscountApprovalPercent ?? 20));
    setInitialized(true);
  }, [settings, initialized]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const order = Number(orderLimit);
    const line = Number(lineLimit);
    if (![order, line].every((value) => Number.isInteger(value) && value >= 0 && value <= 100)) {
      setError("Enter whole-number percentages from 0 to 100.");
      return;
    }
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const { csrfToken } = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/auth/confirm-password", {
        csrfToken,
        init: { method: "POST", body: JSON.stringify({ password }) },
      });
      await apiFetch("/api/v1/business/settings", {
        csrfToken,
        init: { method: "PATCH", body: JSON.stringify({
          orderDiscountApprovalPercent: order,
          lineDiscountApprovalPercent: line,
        }) },
      });
      await business.refetch();
      setSaved("Discount approval limits saved. The API enforces these limits for new sales.");
    } catch (cause) {
      setError(errorText(cause, "Unable to update discount limits."));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5">
      <SectionHeader
        title="Discount approval limits"
        description="These limits apply to the sale-creation authorization check. A discount above a configured percentage requires discount.override or a valid approval grant."
      />
      <p className="mt-4 rounded-xl bg-[#f7f8f5] px-4 py-3 text-sm text-[var(--color-atlas-muted-strong)]">
        Current: order discount <strong>{settings?.orderDiscountApprovalPercent ?? 10}%</strong>;
        line discount <strong>{settings?.lineDiscountApprovalPercent ?? 20}%</strong>.
        Defaults apply until saved.
      </p>
      {business.isError ? <p role="alert" className="mt-3 text-sm text-[#b74945]">Current policy unavailable; saving is disabled.</p> : null}
      <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto] lg:items-end">
        <label className="text-sm font-medium text-[#202826]">Order discount %
          <input className="field mt-1.5" type="number" min={0} max={100} step={1}
            required value={orderLimit} onChange={(event) => setOrderLimit(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-[#202826]">Line discount %
          <input className="field mt-1.5" type="number" min={0} max={100} step={1}
            required value={lineLimit} onChange={(event) => setLineLimit(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-[#202826]">Owner password
          <input className="field mt-1.5" type="password" autoComplete="current-password"
            required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <PrimaryButton type="submit" disabled={busy || business.isLoading || business.isError}>
          {busy ? "Saving…" : "Save limits"}
        </PrimaryButton>
      </form>
      {error ? <p role="alert" className="mt-3 text-sm text-[#b74945]">{error}</p> : null}
      {saved ? <p role="status" className="mt-3 text-sm text-[#267552]">{saved}</p> : null}
      <p className="mt-3 text-xs leading-5 text-[var(--color-atlas-muted-strong)]">
        A setting of 0% requires approval for any positive discount. This does not
        change void approval rules or existing sale history.
      </p>
    </Panel>
  );
}
