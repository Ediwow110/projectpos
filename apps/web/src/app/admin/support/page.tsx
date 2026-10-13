"use client";

import { useState, type JSX, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../../components/AppShell";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { apiFetch, ApiError } from "../../../lib/api";

interface Case { id: string; orderId: string; category: string; description: string; status: "OPEN" | "CLOSED"; createdAt: string }
interface Consent { id: string; purpose: string; expiresAt: string; revokedAt: string | null }
interface Me { role: string; businessName?: string }

async function post(path: string, body: object = {}): Promise<unknown> {
  const { csrfToken } = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
  return apiFetch(path, { csrfToken, init: { method: "POST", body: JSON.stringify(body) } });
}

export default function OwnerSupportPage(): JSX.Element {
  const cache = useQueryClient();
  const [purpose, setPurpose] = useState("");
  const [ttl, setTtl] = useState(15);
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [selected, setSelected] = useState<{ kind: "case" | "consent"; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const owner = me.data?.role === "owner";
  const cases = useQuery({ queryKey: ["guest-support-cases"], queryFn: () => apiFetch<{ items: Case[] }>("/api/v1/admin/support/cases"), enabled: owner, retry: false });
  const consents = useQuery({ queryKey: ["owner-support-consents"], queryFn: () => apiFetch<{ items: Consent[] }>("/api/v1/admin/support/consents"), enabled: owner, retry: false });

  async function grant(event: FormEvent): Promise<void> {
    event.preventDefault(); setBusy(true); setError(""); setMessage(""); setToken("");
    try {
      const response = await post("/api/v1/admin/support/consents", { purpose: purpose.trim(), ttlMinutes: ttl, password }) as { token: string };
      setToken(response.token); setPassword(""); setPurpose("");
      setMessage("Read-only consent issued. Copy the token now; it cannot be recovered later.");
      await cache.invalidateQueries({ queryKey: ["owner-support-consents"] });
    } catch (cause) { setError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : "Consent failed."); }
    finally { setBusy(false); }
  }

  async function confirm(): Promise<void> {
    if (!selected || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await post(selected.kind === "case" ? `/api/v1/admin/support/cases/${encodeURIComponent(selected.id)}/close` : `/api/v1/admin/support/consents/${encodeURIComponent(selected.id)}/revoke`);
      await cache.invalidateQueries({ queryKey: selected.kind === "case" ? ["guest-support-cases"] : ["owner-support-consents"] });
      setMessage(selected.kind === "case" ? "Support case closed; no order or payment was changed." : "Operator consent revoked.");
      setSelected(null);
    } catch (cause) { setError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : "Action failed."); }
    finally { setBusy(false); }
  }

  return <AppShell role={me.data?.role} businessName={me.data?.businessName}><main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-12 pt-3 sm:px-6">
    <PageHeader eyebrow="Owner / Support" title="Support & platform consent" description="Handle guest requests and authorize short-lived, read-only operator diagnostics." />
    {me.isPending ? <Panel className="p-5">Checking access…</Panel> : !owner ? <Panel className="p-5">Owner access required.</Panel> : <>
      {error && <p role="alert" className="rounded-xl bg-[#fff0f0] p-4 text-sm text-[#a34132]">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-[#eaf7f0] p-4 text-sm text-[#1f8a5b]">{message}</p>}
      <Panel className="p-5"><SectionHeader title="Guest support inbox" description="Case closure does not issue refunds, change stock or cancel orders." />
        {cases.isPending ? <p role="status">Loading cases…</p> : cases.isError ? <p role="alert">Could not load support cases.</p> :
          cases.data?.items.length === 0 ? <p className="mt-4 text-sm">No support cases yet.</p> :
          <div className="mt-4 grid gap-3 md:grid-cols-2">{cases.data?.items.map((item) => <article key={item.id} className="min-w-0 rounded-xl border border-[#eee4db] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{item.category} · Order {item.orderId.slice(-8)}</strong><StatusPill tone={item.status === "OPEN" ? "warn" : "ok"}>{item.status}</StatusPill></div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[#655b53]">{item.description}</p>
            <p className="mt-2 break-all font-data text-xs text-[#73685f]">{item.id}</p>
            {item.status === "OPEN" && <GhostButton type="button" onClick={() => setSelected({ kind: "case", id: item.id })}>Close case</GhostButton>}
          </article>)}</div>}
      </Panel>
      <Panel className="p-5"><SectionHeader title="Issue owner consent" description="Requires owner password. Access is limited to aggregate diagnostics and expires within 60 minutes; the operator also requires their own platform key." />
        <form className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)_auto] md:items-end" onSubmit={(event) => void grant(event)}>
          <label className="text-xs font-semibold">Purpose<input className="field mt-1.5" value={purpose} minLength={10} maxLength={200} required onChange={(event) => setPurpose(event.target.value)} /></label>
          <label className="text-xs font-semibold">Minutes<input className="field mt-1.5" type="number" min={1} max={60} value={ttl} onChange={(event) => setTtl(Number(event.target.value))} /></label>
          <label className="text-xs font-semibold">Owner password<input className="field mt-1.5" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <PrimaryButton type="submit" disabled={busy || purpose.trim().length < 10 || !password}>Issue consent</PrimaryButton>
        </form>
        {token && <div role="status" className="mt-4 rounded-xl bg-[#f7f1ea] p-4">
          <strong className="text-xs">One-time consent token — share via an approved secure channel</strong>
          <p className="font-data my-2 break-all text-xs">{token}</p>
          <GhostButton type="button" onClick={() => void navigator.clipboard.writeText(token)}>Copy</GhostButton>
          <GhostButton type="button" onClick={() => setToken("")}>Hide</GhostButton>
        </div>}
      </Panel>
      <Panel className="p-5"><SectionHeader title="Consent history" description="Owner can revoke access immediately; the full token is never stored or listed." />
        {consents.isPending ? <p>Loading…</p> : consents.isError ? <p role="alert">Consents unavailable.</p> :
          consents.data?.items.length === 0 ? <p className="mt-3 text-sm">No consent records.</p> :
          <div className="mt-4 space-y-2">{consents.data?.items.map((item) => {
            const active = !item.revokedAt && Date.parse(item.expiresAt) > Date.now();
            return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
              <div className="min-w-0"><p className="break-words text-sm font-semibold">{item.purpose}</p><p className="text-xs text-[#73685f]">Expires {new Date(item.expiresAt).toLocaleString("en-PH")}</p></div>
              <div className="flex items-center gap-2"><StatusPill tone={active ? "warn" : "ok"}>{item.revokedAt ? "Revoked" : active ? "Active" : "Expired"}</StatusPill>{active && <GhostButton type="button" onClick={() => setSelected({ kind: "consent", id: item.id })}>Revoke</GhostButton>}</div>
            </div>;
          })}</div>}
      </Panel>
    </>}
    <ConfirmDialog open={Boolean(selected)} title={selected?.kind === "case" ? "Close support case?" : "Revoke operator consent?"}
      description={selected?.kind === "case" ? "This does not issue a refund or change the order." : "Revocation blocks future diagnostic reads using this token."}
      confirmLabel={selected?.kind === "case" ? "Close case" : "Revoke access"} busy={busy} onCancel={() => setSelected(null)} onConfirm={() => void confirm()} />
  </main></AppShell>;
}
