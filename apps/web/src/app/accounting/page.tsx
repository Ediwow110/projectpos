"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReportPageFrame } from "../../components/ReportPageFrame";
import { DataTableFrame, MetricCard, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton } from "../../components/ui";
import { ApiError, apiBase, apiFetch } from "../../lib/api";

interface TrialBalance {
  items: Array<{ accountId: string; code: string; name: string; type: string; debitMinor: number; creditMinor: number; debitBalanceMinor: number; creditBalanceMinor: number }>;
  debitMinor: number;
  creditMinor: number;
  currency: string | null;
  completeness: "posted-journal-only";
}

interface JournalPage {
  items: Array<{ entry: { id: string; effectiveAt: string; description: string; sourceType: string; sourceId: string }; lines: Array<{ accountId: string; accountCode: string; accountName: string; debitMinor: number; creditMinor: number; memo: string | null }> }>;
  nextCursor: string | null;
}
interface ProfitAndLoss {
  revenue: Array<{ accountId: string; code: string; name: string; amountMinor: number }>;
  expenses: Array<{ accountId: string; code: string; name: string; amountMinor: number }>;
  revenueMinor: number; expensesMinor: number; netIncomeMinor: number; currency: string | null;
  completeness: "posted-journal-only"; historicalActivationRequired: boolean;
}
interface AccountingAccount { id: string; code: string; name: string; type: string; isActive: boolean }
interface BackfillRun { id: string; status: string; cursor: { family?: string; afterId?: string | null } | null; processedCount: number; skippedCount: number }
interface Activation { status: string; accountingStartAt: string | null; openingEntryId: string | null; latestBackfillRun: BackfillRun | null; backfillIssues: Array<{ reason: string }> }
interface WorksheetLine { accountCode: string; side: "debit" | "credit"; amount: string }
interface OpeningWorksheetBody { accountingStartAt: string; lines: Array<{ accountCode: string; debitMinor: number; creditMinor: number }> }
interface OpeningPreview { draft: { lines: Array<{ accountCode: string; debitMinor: number; creditMinor: number; memo?: string }> }; totals: { debitMinor: number; creditMinor: number } }

function money(amount: number, currency: string | null): string {
  try { return new Intl.NumberFormat("en-PH", { style: "currency", currency: currency ?? "PHP" }).format(amount / 100); }
  catch { return `${currency ?? "PHP"} ${(amount / 100).toFixed(2)}`; }
}

export default function AccountingPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState("");
  const [activityAccountId, setActivityAccountId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [worksheet, setWorksheet] = useState<WorksheetLine[]>([{ accountCode: "1000", side: "debit", amount: "" }]);
  const [preview, setPreview] = useState<OpeningPreview | null>(null);
  const [worksheetError, setWorksheetError] = useState("");
  const [exportError, setExportError] = useState("");
  const profile = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<{ role: string }>("/api/v1/me"), retry: false });
  const activation = useQuery({ queryKey: ["accounting-activation"], queryFn: () => apiFetch<Activation>("/api/v1/accounting/activation"), retry: false });
  const accounts = useQuery({ queryKey: ["accounting-accounts"], queryFn: () => apiFetch<AccountingAccount[]>("/api/v1/accounting/accounts"), retry: false });
  const queryString = new URLSearchParams({ ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) }).toString();
  const balance = useQuery({ queryKey: ["accounting-trial-balance", dateFrom, dateTo], queryFn: () => apiFetch<TrialBalance>(`/api/v1/accounting/trial-balance${queryString ? `?${queryString}` : ""}`), retry: false });
  const pnl = useQuery({ queryKey: ["accounting-pnl", dateFrom, dateTo], queryFn: () => apiFetch<ProfitAndLoss>(`/api/v1/accounting/profit-and-loss${queryString ? `?${queryString}` : ""}`), retry: false });
  const activityQuery = new URLSearchParams({ limit: "20", ...(activityAccountId ? { accountId: activityAccountId } : {}) }).toString();
  const journal = useQuery({ queryKey: ["accounting-journal", activityAccountId], queryFn: () => apiFetch<JournalPage>(`/api/v1/accounting/journal?${activityQuery}`), retry: false });
  async function downloadJournalCsv(): Promise<void> {
    setExportError("");
    try {
      const query = new URLSearchParams({ ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) });
      const response = await fetch(`${apiBase()}/api/v1/accounting/journal.csv?${query}`, { credentials: "include" });
      if (!response.ok) throw new Error("Journal CSV export failed. Check your accounting read access and date range.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "nexpos-accounting-journal.csv"; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { setExportError(error instanceof Error ? error.message : "Journal CSV export failed."); }
  }
  const makeBody = (): OpeningWorksheetBody => {
    if (!startAt) throw new Error("Choose accounting start date.");
    const lines = worksheet.map((line) => {
      if (!/^\d+(\.\d{1,2})?$/.test(line.amount)) throw new Error("Enter amount with up to two decimal places for each line.");
      const [whole, fraction = ""] = line.amount.split(".");
      const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Each opening balance must be greater than zero and within supported range.");
      return { accountCode: line.accountCode, debitMinor: line.side === "debit" ? amount : 0, creditMinor: line.side === "credit" ? amount : 0 };
    });
    return { accountingStartAt: startAt, lines };
  };
  const openingPreview = useMutation({ mutationFn: async (body: OpeningWorksheetBody) => {
    const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
    return apiFetch<OpeningPreview>("/api/v1/accounting/activation/opening-balance/preview", { csrfToken: csrf.csrfToken, init: { method: "POST", body: JSON.stringify(body) } });
  }, onSuccess: (data) => { setPreview(data); setWorksheetError(""); }, onError: (error) => setWorksheetError(error instanceof ApiError ? `${error.code}: ${error.message}` : "Opening balance preview failed.") });
  const confirmOpening = useMutation({ mutationFn: async (body: OpeningWorksheetBody) => {
    const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
    return apiFetch<{ activation: Activation }>("/api/v1/accounting/activation/opening-balance", { csrfToken: csrf.csrfToken, init: { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) } });
  }, onSuccess: async () => { setPreview(null); setWorksheetError(""); await queryClient.invalidateQueries({ queryKey: ["accounting-activation"] }); await queryClient.invalidateQueries({ queryKey: ["accounting-trial-balance"] }); await queryClient.invalidateQueries({ queryKey: ["accounting-journal"] }); }, onError: (error) => setWorksheetError(error instanceof ApiError ? `${error.code}: ${error.message}` : "Opening balance confirmation failed.") });
  const startBackfill = useMutation({ mutationFn: async () => {
    const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
    return apiFetch<BackfillRun>("/api/v1/accounting/activation/backfill", { csrfToken: csrf.csrfToken, init: { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } } });
  }, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["accounting-activation"] }); }, onError: (error) => setWorksheetError(error instanceof ApiError ? `${error.code}: ${error.message}` : "Historical backfill could not start.") });
  const runBackfillBatch = useMutation({ mutationFn: async () => {
    const run = activation.data?.latestBackfillRun;
    if (!run?.cursor?.family) throw new Error("Backfill cursor is not available.");
    const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
    return apiFetch<BackfillRun>(`/api/v1/accounting/activation/backfill/${run.id}/run`, { csrfToken: csrf.csrfToken, init: { method: "POST", body: JSON.stringify({ expectedCursor: { family: run.cursor.family, afterId: run.cursor.afterId ?? null } }) } });
  }, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["accounting-activation"] }); }, onError: (error) => setWorksheetError(error instanceof ApiError ? `${error.code}: ${error.message}` : "Historical backfill batch failed.") });
  const currency = balance.data?.currency ?? "PHP";
  return (
    <ReportPageFrame title="Accounting" description="Review posted journal activity, profit and loss, and account balances." actions={<Link href="/payables" className="inline-flex min-h-10 items-center rounded-[10px] bg-[#f35d3f] px-4 text-sm font-semibold text-white hover:bg-[#d94a30]">Supplier payables</Link>}>
      {activation.data && profile.data?.role === "owner" && activation.data.status !== "ACTIVE" ? <Panel className="p-5"><SectionHeader title="Historical activation" description="Backfill source records in bounded batches. Unresolved records stay visible; reports remain gated until reconciliation is complete." /><p className="mt-2 text-sm text-[#73685f]">Status: {activation.data.status}. {activation.data.accountingStartAt ? `Accounting starts ${new Date(activation.data.accountingStartAt).toLocaleDateString()}.` : "Opening balances are not confirmed."}</p>{activation.data.latestBackfillRun ? <p className="mt-1 text-sm text-[#73685f]">Latest run: {activation.data.latestBackfillRun.status} · {activation.data.latestBackfillRun.processedCount} posted · {activation.data.latestBackfillRun.skippedCount} skipped</p> : null}<div className="mt-4 flex flex-wrap gap-2">{(!activation.data.latestBackfillRun || activation.data.latestBackfillRun.status === "PAUSED") ? <PrimaryButton type="button" disabled={startBackfill.isPending} onClick={() => { setWorksheetError(""); startBackfill.mutate(); }}>{activation.data.latestBackfillRun?.status === "PAUSED" ? "Restart historical backfill" : "Start historical backfill"}</PrimaryButton> : null}{activation.data.latestBackfillRun?.status === "RUNNING" ? <PrimaryButton type="button" disabled={runBackfillBatch.isPending} onClick={() => { setWorksheetError(""); runBackfillBatch.mutate(); }}>Run next backfill batch</PrimaryButton> : null}</div>{activation.data.latestBackfillRun?.status === "PAUSED" ? <p role="status" className="mt-3 text-sm text-[#624718]">Backfill paused. Review unresolved values or confirm opening balances before restarting. Profit and loss remains unavailable.</p> : null}{worksheetError ? <p role="alert" className="mt-3 text-sm text-[#c43e3e]">{worksheetError}</p> : null}{activation.data.backfillIssues.length ? <ul aria-label="Historical activation issues" className="mt-3 grid gap-1 text-sm text-[#73685f]">{activation.data.backfillIssues.map((issue, index) => <li key={`${issue.reason}-${index}`}>{issue.reason}</li>)}</ul> : null}</Panel> : null}
      {(activation.data?.status === "NOT_STARTED" || activation.data?.status === "BACKFILLING") && !activation.data.openingEntryId && profile.data?.role === "owner" ? <Panel className="p-5"><SectionHeader title="Opening balance worksheet" description="Enter balances from existing records or your accountant. The retained earnings offset balances the worksheet. This posts one dated opening journal; historical source backfill runs separately." /><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Accounting start date<input aria-label="Accounting start date" type="date" value={startAt} onChange={(event) => { setStartAt(event.target.value); setPreview(null); }} className="field mt-1" /></label></div><div className="mt-4 grid gap-3">{worksheet.map((line, index) => <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_180px_auto]"><label className="text-xs font-semibold">Opening account {index + 1}<select aria-label={`Opening account ${index + 1}`} value={line.accountCode} onChange={(event) => { const next = [...worksheet]; next[index] = { ...line, accountCode: event.target.value }; setWorksheet(next); setPreview(null); }} className="field mt-1">{(accounts.data ?? []).filter((account) => account.isActive && ["asset", "liability", "equity"].includes(account.type) && account.code !== "3000").map((account) => <option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}</select></label><label className="text-xs font-semibold">Side<select aria-label={`Opening side ${index + 1}`} value={line.side} onChange={(event) => { const next = [...worksheet]; next[index] = { ...line, side: event.target.value as WorksheetLine["side"] }; setWorksheet(next); setPreview(null); }} className="field mt-1"><option value="debit">Debit</option><option value="credit">Credit</option></select></label><label className="text-xs font-semibold">Amount<input aria-label={`Opening amount ${index + 1}`} inputMode="decimal" value={line.amount} onChange={(event) => { const next = [...worksheet]; next[index] = { ...line, amount: event.target.value }; setWorksheet(next); setPreview(null); }} className="field mt-1" /></label><GhostButton type="button" aria-label={`Remove opening line ${index + 1}`} disabled={worksheet.length === 1} onClick={() => { setWorksheet(worksheet.filter((_, lineIndex) => lineIndex !== index)); setPreview(null); }}>Remove</GhostButton></div>)}</div><div className="mt-4 flex flex-wrap gap-2"><GhostButton type="button" onClick={() => { setWorksheet([...worksheet, { accountCode: "1000", side: "debit", amount: "" }]); setPreview(null); }}>Add account line</GhostButton><PrimaryButton type="button" disabled={openingPreview.isPending} onClick={() => { try { const body = makeBody(); setWorksheetError(""); openingPreview.mutate(body); } catch (error) { setWorksheetError(error instanceof Error ? error.message : "Invalid opening balance."); } }}>Preview opening entry</PrimaryButton></div>{worksheetError ? <p role="alert" className="mt-3 text-sm text-[#c43e3e]">{worksheetError}</p> : null}{preview ? <div className="mt-4 rounded-xl border border-[#d6e4d3] bg-[#f5fbf4] p-4"><h3 className="text-sm font-semibold">Balanced preview · {money(preview.totals.debitMinor, currency)}</h3><ul className="mt-3 grid gap-2 text-sm">{preview.draft.lines.map((line, index) => <li key={`${line.accountCode}-${index}`} className="flex justify-between gap-4"><span>{line.accountCode}{line.memo ? ` · ${line.memo}` : ""}</span><span>{line.debitMinor ? `Dr ${money(line.debitMinor, currency)}` : `Cr ${money(line.creditMinor, currency)}`}</span></li>)}</ul><PrimaryButton type="button" className="mt-4" disabled={confirmOpening.isPending} onClick={() => { try { confirmOpening.mutate(makeBody()); } catch (error) { setWorksheetError(error instanceof Error ? error.message : "Invalid opening balance."); } }}>Confirm and post opening entry</PrimaryButton></div> : null}</Panel> : null}
      {activation.data?.status === "REVIEW" ? <Panel className="border-[#f0d8a6] bg-[#fff9e9] p-5"><p className="text-sm font-semibold text-[#624718]">Opening balances posted. Historical activation still needs review.</p><p className="mt-1 text-sm text-[#73685f]">Historical source backfill and reconciliation must finish before profit and loss becomes available.</p></Panel> : null}
      <Panel className="border-[#f0d8a6] bg-[#fff9e9] p-5">
        <p className="text-sm font-semibold text-[#624718]">Historical activation pending</p>
        <p className="mt-1 text-sm text-[#73685f]">Reports below include posted journal entries only. They exclude historical backfill and opening balances, so they are not a complete business result.</p>
      </Panel>
      <Panel className="p-5"><SectionHeader title="Profit and loss" description="Posted journal entries in the selected effective-date range." /><div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-xs font-semibold">From<input aria-label="P&L date from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="field mt-1" /></label><label className="text-xs font-semibold">To<input aria-label="P&L date to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="field mt-1" /></label><GhostButton type="button" onClick={() => void downloadJournalCsv()}>Download journal CSV</GhostButton></div>{exportError ? <p role="alert" className="mt-3 text-sm text-[#c43e3e]">{exportError}</p> : null}{pnl.isLoading ? <p role="status" className="mt-4 text-sm">Loading profit and loss…</p> : null}{pnl.isError ? <p role="alert" className="mt-4 text-sm text-[#c43e3e]">{pnl.error instanceof ApiError ? `${pnl.error.code}: ${pnl.error.message}` : "Could not load profit and loss."}</p> : null}{pnl.data ? <div className="mt-4 grid gap-3 sm:grid-cols-3"><MetricCard label="Revenue" value={money(pnl.data.revenueMinor, pnl.data.currency)} icon="↗" tone="success" meta={`${pnl.data.revenue.length} accounts`} /><MetricCard label="Expenses" value={money(pnl.data.expensesMinor, pnl.data.currency)} icon="↘" tone="warning" meta={`${pnl.data.expenses.length} accounts`} /><MetricCard label="Net income" value={money(pnl.data.netIncomeMinor, pnl.data.currency)} icon="∑" tone="info" meta="Posted journal only" /></div> : null}</Panel>
      {balance.data ? <section aria-label="Trial balance totals" className="grid gap-4 sm:grid-cols-2"><MetricCard label="Debits" value={money(balance.data.debitMinor, currency)} icon="↓" tone="info" meta="Posted journal total" /><MetricCard label="Credits" value={money(balance.data.creditMinor, currency)} icon="↑" tone="success" meta="Posted journal total" /></section> : null}
      {balance.isLoading ? <div role="status"><Panel className="p-5 text-sm text-[#73685f]">Loading account balances…</Panel></div> : null}
      {balance.isError ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{balance.error instanceof ApiError ? `${balance.error.code}: ${balance.error.message}` : "Could not load account balances."}</p></Panel> : null}
      {balance.data ? <DataTableFrame><div className="px-5 py-4"><SectionHeader title="Posted balance summary" description="Account totals from posted entries in the active business and branch scope." /></div>{balance.data.items.length === 0 ? <p className="px-5 pb-8 text-sm text-[#73685f]">No journal entries have been posted.</p> : <div className="overflow-x-auto"><table className="premium-table min-w-[680px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Account</th><th className="px-5 pb-3 text-right">Debits</th><th className="px-5 pb-3 text-right">Credits</th><th className="px-5 pb-3 text-right">Debit balance</th><th className="px-5 pb-3 text-right">Credit balance</th></tr></thead><tbody>{balance.data.items.map((row) => <tr key={row.accountId}><th scope="row" className="px-5 py-3 font-semibold">{row.code} · {row.name}</th><td className="font-data px-5 py-3 text-right">{money(row.debitMinor, currency)}</td><td className="font-data px-5 py-3 text-right">{money(row.creditMinor, currency)}</td><td className="font-data px-5 py-3 text-right">{money(row.debitBalanceMinor, currency)}</td><td className="font-data px-5 py-3 text-right">{money(row.creditBalanceMinor, currency)}</td></tr>)}</tbody></table></div>}</DataTableFrame> : null}
      <DataTableFrame><div className="flex flex-wrap items-end justify-between gap-3 px-5 py-4"><SectionHeader title="Account activity" description="Review posted journal entries for one account, or view all accounts." /><label className="text-xs font-semibold">Account<select aria-label="Account activity filter" value={activityAccountId} onChange={(event) => setActivityAccountId(event.target.value)} className="field mt-1"><option value="">All accounts</option>{(accounts.data ?? []).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label></div>{journal.isLoading ? <p role="status" className="px-5 pb-6 text-sm text-[#73685f]">Loading account activity…</p> : null}{journal.isError ? <p role="alert" className="px-5 pb-6 text-sm text-[#c43e3e]">{journal.error instanceof ApiError ? `${journal.error.code}: ${journal.error.message}` : "Could not load account activity."}</p> : null}{journal.data?.items.length === 0 ? <p className="px-5 pb-8 text-sm text-[#73685f]">No journal entries have been posted for this account.</p> : null}{journal.data?.items.map(({ entry, lines }) => <article key={entry.id} className="border-t border-[#eee5de] px-5 py-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-[#2a241f]">{entry.description || entry.sourceType}</h3><time className="text-xs text-[#73685f]" dateTime={entry.effectiveAt}>{new Date(entry.effectiveAt).toLocaleDateString()}</time></div><p className="mt-1 text-xs text-[#73685f]">{entry.sourceType} · {entry.sourceId}</p><ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">{lines.map((line) => <li key={line.accountId + line.debitMinor + line.creditMinor} className="flex justify-between gap-3"><span>{line.accountCode} · {line.accountName}{line.memo ? ` — ${line.memo}` : ""}</span><span className="font-data tabular-nums">{line.debitMinor ? `Dr ${money(line.debitMinor, currency)}` : `Cr ${money(line.creditMinor, currency)}`}</span></li>)}</ul></article>)}</DataTableFrame>
    </ReportPageFrame>
  );
}
