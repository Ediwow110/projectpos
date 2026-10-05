"use client";

import React, { type FormEvent, type JSX } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { ApiError, apiFetch } from "../../../lib/api";
import { LoyaltySettingsForm } from "./LoyaltySettingsForm";
import {
  emptyLoyaltySettings,
  formFromProgram,
  loyaltyPayload,
  type LoyaltyProgramSettings,
  type LoyaltySettingsErrors,
  type LoyaltySettingsForm as LoyaltySettingsFormValues,
  validateLoyaltySettings,
} from "../../../lib/loyalty-settings";

interface Me { role: string; businessName?: string }

export default function LoyaltySettingsPage(): JSX.Element {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const role = meQuery.data?.role ?? "cashier";
  const canManage = role === "owner" || role === "manager";
  const programQuery = useQuery({
    queryKey: ["loyalty-program"],
    queryFn: () => apiFetch<LoyaltyProgramSettings | null>("/api/v1/loyalty/program"),
    enabled: canManage,
    retry: false,
  });
  const [form, setForm] = useState<LoyaltySettingsFormValues>(emptyLoyaltySettings);
  const [errors, setErrors] = useState<LoyaltySettingsErrors>({});
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (programQuery.data === undefined) return;
    setForm(programQuery.data ? formFromProgram(programQuery.data) : emptyLoyaltySettings());
  }, [programQuery.data]);

  function update(field: keyof LoyaltySettingsFormValues, value: string | boolean): void {
    setForm((current) => ({ ...current, [field]: value }));
    if (field !== "enabled") setErrors((current) => ({ ...current, [field]: undefined }));
    setSuccess(""); setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextErrors = validateLoyaltySettings(form);
    setErrors(nextErrors); setSuccess(""); setError("");
    const payload = loyaltyPayload(form);
    if (Object.keys(nextErrors).length > 0 || payload === null) return;
    setBusy(true);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch<LoyaltyProgramSettings>("/api/v1/loyalty/program", { csrfToken: csrf.csrfToken, init: { method: "POST", body: JSON.stringify(payload) } });
      setSuccess("Loyalty settings saved. The new rules are now active for this business.");
      await programQuery.refetch();
    } catch (cause) {
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) setError("You do not have permission to manage loyalty settings.");
      else setError(cause instanceof ApiError ? cause.message : "Loyalty settings could not be saved.");
    } finally { setBusy(false); }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role}>
      <main className="mx-auto max-w-[1000px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader eyebrow="Administration / Loyalty" title="Loyalty settings" description="Set clear earn and redeem rules for customer rewards. Currency values are displayed in pesos and saved safely as whole minor units." actions={<Link href="/admin" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Administration</Link>} />
        {!meQuery.isLoading && !canManage ? <Panel className="border-[#f1d6ad] bg-[#fff8ea] p-5"><SectionHeader title="Loyalty settings are restricted" description="Owner or manager access is required. Cashiers can use loyalty at checkout but cannot change its rules." /></Panel> : null}
        {canManage && programQuery.isLoading ? <Panel className="p-5"><p role="status" className="text-sm text-[#73685f]">Loading loyalty settings…</p></Panel> : null}
        {canManage && programQuery.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{programQuery.error instanceof ApiError && programQuery.error.status === 403 ? "You do not have permission to view loyalty settings." : "Loyalty settings could not be loaded."}</p></Panel> : null}
        {canManage && programQuery.data !== undefined && !programQuery.isError ? <Panel className="p-5 sm:p-6"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><SectionHeader title="Program rules" description="Use deterministic rules that are easy for staff and customers to understand." />{programQuery.data ? <span className="rounded-full bg-[#eaf7f0] px-3 py-1 text-[11px] font-semibold text-[#1f8a5b]">Version {programQuery.data.version}</span> : null}</div>{success ? <div role="status" className="mb-4 rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] p-4 text-sm font-medium text-[#1f8a5b]" aria-live="polite">{success}</div> : null}{error ? <div role="alert" className="mb-4 rounded-xl border border-[#efb9b9] bg-[#fff0f0] p-4 text-sm font-medium text-[#c43e3e]">{error}</div> : null}<LoyaltySettingsForm form={form} errors={errors} busy={busy} noProgram={programQuery.data === null} onChange={update} onSubmit={(event) => void save(event)} /></Panel> : null}
      </main>
    </AppShell>
  );
}
