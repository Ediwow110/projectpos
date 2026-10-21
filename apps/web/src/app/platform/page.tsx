"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageHeader, Panel, SectionHeader } from "../../components/premium";
import { PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";

interface Csrf { csrfToken: string; }
interface Me { role: string; businessName?: string; }

export default function PlatformPage(): JSX.Element {
  const [platformKey, setPlatformKey] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [flagKey, setFlagKey] = useState("");
  const [flagEnabled, setFlagEnabled] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });

  async function call<T>(path: string, method: string, body: unknown): Promise<T> {
    const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
    return apiFetch<T>(path, {
      csrfToken: csrf.csrfToken,
      init: { method, body: JSON.stringify(body), headers: { "x-platform-key": platformKey } },
    });
  }

  async function setFlag(): Promise<void> {
    setError("");
    setStatus("");
    setBusy(true);
    try {
      await call(`/api/v1/platform/businesses/${businessId.trim()}/flags`, "PATCH", {
        key: flagKey.trim(),
        enabled: flagEnabled,
      });
      setStatus(`Flag ${flagKey.trim()} set to ${flagEnabled}.`);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Flag update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <p className="text-xs font-semibold"><Link href="/platform/tenant-health" className="underline">Open owner-consented tenant health diagnostics</Link></p>
        <PageHeader
          eyebrow="Platform / Restricted operations"
          title="Platform operations"
          description="Platform-wide administrative overrides use an operator key. Tenant diagnostic access is separate and requires explicit owner consent."
          actions={<Link href="/" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Dashboard</Link>}
        />

        <Panel className="border-[#f0d7ab] bg-[#fff8eb] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-display text-base font-semibold text-[#5f3b04]">Restricted operator surface</h2><p className="mt-1 text-[11px] leading-5 text-[#8a5606]">Platform overrides require the independent operator key. This privileged administrative surface is not the owner-consented, read-only diagnostic view; do not use it for normal store operations.</p></div>
            <StatusPill tone="warn">Privileged</StatusPill>
          </div>
        </Panel>

        {status ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[var(--color-atlas-verified)]">{status}</div> : null}
        {error ? <div role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-4 py-3 text-sm font-medium text-[#c43e3e]">{error}</div> : null}

        <div className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
          <Panel className="p-5">
            <SectionHeader title="Operator authentication" description="The key is held only in React state and disappears when this page is refreshed or closed." />
            <label className="mt-4 block text-[11px] font-semibold text-[#655b53]">
              Platform key
              <input type="password" value={platformKey} onChange={(event) => setPlatformKey(event.target.value)} autoComplete="off" placeholder="Required for platform actions" className="field mt-1.5" />
            </label>
            <div className="mt-4 rounded-xl bg-[#f7f1ea] p-3 text-[10px] leading-5 text-[#73685f]">The key is sent only in the <span className="font-data">x-platform-key</span> header for the action being performed.</div>
          </Panel>

          <Panel className="p-5">
            <SectionHeader title="Feature flag override" description="Target one business and one flag explicitly. The change is confirmed before it is sent." />
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                setStatus("");
                setConfirmOpen(true);
              }}
              className="mt-4 space-y-4"
            >
              <label className="block text-[11px] font-semibold text-[#655b53]">Business ID<input value={businessId} onChange={(event) => setBusinessId(event.target.value)} placeholder="Target business ID" className="field mt-1.5" /></label>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                <label className="text-[11px] font-semibold text-[#655b53]">Flag key<input value={flagKey} onChange={(event) => setFlagKey(event.target.value)} placeholder="reports" className="field mt-1.5" /></label>
                <label className="flex min-h-[50px] items-center gap-3 self-end rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-[12px] font-semibold text-[#655b53]"><input type="checkbox" checked={flagEnabled} onChange={(event) => setFlagEnabled(event.target.checked)} className="h-4 w-4 accent-[#f35d3f]" />Enabled</label>
              </div>
              <PrimaryButton type="submit" disabled={!platformKey || !businessId.trim() || !flagKey.trim()}>Review flag change</PrimaryButton>
            </form>
          </Panel>
        </div>
      </main>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => !busy && setConfirmOpen(false)}
        onConfirm={() => void setFlag()}
        busy={busy}
        tone={flagEnabled ? "primary" : "danger"}
        title={flagEnabled ? "Enable feature flag?" : "Disable feature flag?"}
        description="This changes a platform override for the specified business. Verify both identifiers before confirming."
        confirmLabel={flagEnabled ? "Enable flag" : "Disable flag"}
        details={<div className="space-y-1"><p>Business: <span className="font-data text-[#2a241f]">{businessId}</span></p><p>Flag: <strong className="text-[#2a241f]">{flagKey}</strong></p></div>}
      />
    </AppShell>
  );
}
