"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { Modal } from "../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { apiFetch, ApiError } from "../../lib/api";
import { formatMoneyMinor } from "../../lib/money";

interface Me { role: string; businessName?: string }
interface GiftCard { id: string; maskedCode: string; codeLast4: string; status: string; balanceMinor: number }
interface IssuedCard { id: string; maskedCode: string; code?: string; status: string }

function money(minor: number): string {
  return formatMoneyMinor(minor);
}

export default function GiftCardsPage(): JSX.Element {
  const [issueOpen, setIssueOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const cards = useQuery({ queryKey: ["gift-cards"], queryFn: () => apiFetch<GiftCard[]>("/api/v1/gift-cards"), retry: false });
  const canIssue = ["owner", "manager"].includes(me.data?.role ?? "");
  const totalLiability = (cards.data ?? []).reduce((sum, card) => sum + card.balanceMinor, 0);
  const active = (cards.data ?? []).filter((card) => card.status === "ACTIVE").length;

  async function issue(): Promise<void> {
    setBusy(true); setError("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const result = await apiFetch<IssuedCard>("/api/v1/gift-cards/issue", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) },
      });
      setIssued(result); setIssueOpen(false); await cards.refetch();
    } catch (cause) {
      setError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : "Gift-card issuance failed.");
    } finally { setBusy(false); }
  }

  return (
    <AppShell businessName={me.data?.businessName} role={me.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader eyebrow="Customers / Stored value" title="Gift cards" description="Issue, monitor, and audit gift-card balances without exposing bearer codes after issuance." actions={<><Link href="/customers" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Customers</Link>{canIssue ? <PrimaryButton type="button" onClick={() => { setError(""); setIssueOpen(true); }}>+ Issue gift card</PrimaryButton> : null}</>} />
        {issued?.code ? <Panel className="border-[#cfe9dc] bg-[#eaf7f0] p-5"><SectionHeader title="Card issued — copy this code now" description="The bearer code is shown only once. Store it securely and hand it to the customer." /><div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center"><code className="rounded-lg bg-white px-4 py-3 text-sm font-semibold tracking-[0.12em] text-[#2a241f]">{issued.code}</code><GhostButton type="button" onClick={() => void navigator.clipboard.writeText(issued.code ?? "")}>Copy code</GhostButton><GhostButton type="button" onClick={() => setIssued(null)}>Dismiss</GhostButton></div></Panel> : null}
        {error ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p></Panel> : null}
        <section className="grid gap-4 sm:grid-cols-3" aria-label="Gift-card summary"><MetricCard label="Cards" value={(cards.data ?? []).length} icon="▤" meta="Issued in this business" /><MetricCard label="Active cards" value={active} icon="✓" tone="success" meta="Not suspended or void" /><MetricCard label="Outstanding liability" value={`₱${money(totalLiability)}`} icon="₱" tone="info" meta="Current ledger balances" /></section>
        <DataTableFrame><div className="px-5 py-4"><SectionHeader title="Gift-card register" description="Only masked identifiers and ledger-derived balances are displayed." /></div>{cards.isLoading ? <p className="px-5 pb-8 text-sm text-[#73685f]">Loading gift cards…</p> : null}{cards.data?.length === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No gift cards have been issued.</p> : null}{(cards.data ?? []).length > 0 ? <table className="premium-table min-w-[680px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Card</th><th className="px-5 pb-3">Status</th><th className="px-5 pb-3 text-right">Balance</th><th className="px-5 pb-3 text-right">History</th></tr></thead><tbody>{(cards.data ?? []).map((card) => <tr key={card.id}><td className="font-data px-5 py-3 font-semibold text-[#2a241f]">{card.maskedCode}</td><td className="px-5 py-3"><StatusPill tone={card.status === "ACTIVE" ? "ok" : "warn"}>{card.status}</StatusPill></td><td className="font-data px-5 py-3 text-right font-medium">₱{money(card.balanceMinor)}</td><td className="px-5 py-3 text-right"><Link href={`/gift-cards/${card.id}`} className="text-[11px] font-semibold text-[#e44e34]">Review →</Link></td></tr>)}</tbody></table> : null}</DataTableFrame>
      </main>
      <Modal open={issueOpen && canIssue} onClose={() => !busy && setIssueOpen(false)} title="Issue gift card" description="Generate a new active card. The raw bearer code will be displayed once after issuance." footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setIssueOpen(false)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="button" onClick={() => void issue()} disabled={busy}>{busy ? "Issuing…" : "Issue card"}</PrimaryButton></div>}><p className="text-sm leading-6 text-[#655b53]">Gift cards start at a zero balance and are loaded through a completed sale. Every balance change is recorded in the append-only value ledger.</p></Modal>
    </AppShell>
  );
}
