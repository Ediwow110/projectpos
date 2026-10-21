"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { GiftCardValueControls } from "../../../components/GiftCardValueControls";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { formatMoneyMinor } from "../../../lib/money";

interface Me { role: string; businessName?: string; permissions?: string[] }
interface Transaction { id: string; type: string; amountDeltaMinor: number; reason: string | null; createdAt: string }
interface CardHistory { id: string; maskedCode: string; status: string; transactions: Transaction[] }

function money(minor: number): string { return formatMoneyMinor(minor); }

export default function GiftCardDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const query = useQuery({ queryKey: ["gift-card", id], queryFn: () => apiFetch<CardHistory>(`/api/v1/gift-cards/${id}/history`), retry: false });
  const balance = (query.data?.transactions ?? []).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
  if (query.isError) return <AppShell businessName={me.data?.businessName} role={me.data?.role}><main className="mx-auto max-w-[1240px] p-6"><Panel className="border-[#efb9b9] bg-[#fff0f0] p-6"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : "Gift card not found."}</p><Link href="/gift-cards" className="mt-3 inline-block text-sm font-semibold text-[var(--color-atlas-accent-strong)]">← Gift cards</Link></Panel></main></AppShell>;
  return <AppShell businessName={me.data?.businessName} role={me.data?.role}><main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6"><PageHeader eyebrow="Customers / Stored value" title={query.data?.maskedCode ?? "Gift card"} description="Append-only activity for one gift card. Bearer codes are never returned by history endpoints." actions={<Link href="/gift-cards" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Gift cards</Link>} />{query.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading history…</Panel> : null}{query.data ? <><section className="grid gap-4 sm:grid-cols-3"><MetricCard label="Balance" value={`₱${money(balance)}`} icon="₱" tone="info" meta="Ledger-derived" /><MetricCard label="Transactions" value={query.data.transactions.length} icon="▤" meta="Append-only entries" /><MetricCard label="Status" value={<span className="text-base">{query.data.status}</span>} icon="✓" tone={query.data.status === "ACTIVE" ? "success" : "warning"} meta="Card lifecycle" /></section><GiftCardValueControls cardId={id} status={query.data.status} balanceMinor={balance} permissions={me.data?.permissions ?? []} role={me.data?.role ?? ""} onChanged={() => void query.refetch()} /><DataTableFrame><div className="px-5 py-4"><SectionHeader title="Ledger history" description="Each entry is tied to an operational event or authorized adjustment." /></div>{query.data.transactions.length === 0 ? <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">No activity recorded.</p> : <table className="premium-table min-w-[720px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Date</th><th className="px-5 pb-3">Type</th><th className="px-5 pb-3">Reason</th><th className="px-5 pb-3 text-right">Change</th></tr></thead><tbody>{query.data.transactions.map((row) => <tr key={row.id}><td className="font-data px-5 py-3 text-[#73685f]">{new Date(row.createdAt).toLocaleString("en-PH")}</td><td className="px-5 py-3"><StatusPill tone={row.amountDeltaMinor < 0 ? "warn" : "ok"}>{row.type}</StatusPill></td><td className="px-5 py-3 text-[#73685f]">{row.reason ?? "—"}</td><td className={`font-data px-5 py-3 text-right font-semibold ${row.amountDeltaMinor < 0 ? "text-[#c43e3e]" : "text-[var(--color-atlas-verified)]"}`}>{row.amountDeltaMinor > 0 ? "+" : ""}₱{money(row.amountDeltaMinor)}</td></tr>)}</tbody></table>}</DataTableFrame></> : null}</main></AppShell>;
}
