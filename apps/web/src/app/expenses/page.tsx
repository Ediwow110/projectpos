"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { Modal } from "../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { DangerButton, GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { apiBase, apiFetch } from "../../lib/api";
import { RequestError } from "../../lib/billing-ui";
import { canVoidExpense } from "../../lib/expenses";

interface Me {
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

interface ExpenseRow {
  id: string;
  category: string;
  amountMinor: number;
  method: string;
  expenseDate: string;
  voidedAt: string | null;
}

const METHODS = ["cash", "card", "gcash", "maya", "bank_transfer", "other"];

function money(minor: number): string {
  return (minor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function methodLabel(method: string): string {
  return method.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function ExpensesPage(): JSX.Element {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [description, setDescription] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<ExpenseRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const listQuery = useQuery({
    queryKey: ["expenses", filterCategory],
    queryFn: () => apiFetch<{ items: ExpenseRow[]; total: number }>(
      "/api/v1/expenses?" + new URLSearchParams({
        ...(filterCategory.trim() ? { category: filterCategory.trim() } : {}),
        page: "1",
        pageSize: "20",
      }).toString(),
    ),
    retry: false,
  });

  const items = listQuery.data?.items ?? [];
  const voidable = canVoidExpense(meQuery.data?.role ?? "cashier");
  const exportable = meQuery.data !== undefined && ["owner", "manager", "inventory"].includes(meQuery.data.role);
  const activeItems = items.filter((expense) => expense.voidedAt === null);
  const visibleTotal = activeItems.reduce((sum, expense) => sum + expense.amountMinor, 0);
  const cashTotal = activeItems.filter((expense) => expense.method === "cash").reduce((sum, expense) => sum + expense.amountMinor, 0);

  async function createExpense(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess("");
    if (!category.trim()) {
      setError(new Error("VALIDATION: Expense category is required."));
      return;
    }
    const amountMinor = Math.round(Number(amount) * 100);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      setError(new Error("VALIDATION: Enter an amount greater than zero."));
      return;
    }
    setBusy(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/expenses", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            category: category.trim(),
            amountMinor,
            method,
            ...(description.trim() ? { description: description.trim() } : {}),
          }),
        },
      });
      setCategory("");
      setAmount("");
      setDescription("");
      setMethod("cash");
      setCreateOpen(false);
      setSuccess("Expense recorded.");
      await listQuery.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function voidExpense(): Promise<void> {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      setError(new Error("VALIDATION: A reason is required to void an expense."));
      return;
    }
    setError(null);
    setSuccess("");
    setBusy(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/expenses/${voidTarget.id}/void`, {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ reason: voidReason.trim() }) },
      });
      setSuccess(`${voidTarget.category} expense was voided.`);
      setVoidTarget(null);
      setVoidReason("");
      await listQuery.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Cash control / Operating expenses"
          title="Expenses"
          description="Record operational spend separately from sales so cash movement and reporting stay auditable."
          actions={
            <>
              {exportable ? <a href={`${apiBase()}/api/v1/expenses/export?format=csv`} className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Export CSV</a> : null}
              <PrimaryButton type="button" onClick={() => { setError(null); setSuccess(""); setCreateOpen(true); }}>+ Record expense</PrimaryButton>
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Expense summary">
          <MetricCard label="Matching expenses" value={(listQuery.data?.total ?? 0).toLocaleString("en-PH")} icon="▦" meta="Current filter" />
          <MetricCard label="Visible active spend" value={`₱${money(visibleTotal)}`} icon="−" tone="warning" meta="Current page only" />
          <MetricCard label="Visible cash spend" value={`₱${money(cashTotal)}`} icon="₱" tone="info" meta="Current page only" />
          <MetricCard label="Voided on page" value={items.filter((expense) => expense.voidedAt !== null).length} icon="×" tone="success" meta="Excluded from active spend" />
        </section>

        {success ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[#1f8a5b]">{success}</div> : null}
        <RequestError error={error} fallback="Action failed" />

        <Panel className="p-5">
          <SectionHeader title="Expense filters" description="Filter by the category text stored on the expense record." />
          <label className="mt-4 block max-w-md text-[11px] font-semibold text-[#655b53]">
            Category
            <input value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)} placeholder="Ice, transport…" className="field mt-1.5" />
          </label>
        </Panel>

        <DataTableFrame>
          <div className="px-5 py-4"><SectionHeader title="Expense ledger" description="Voided expenses remain visible for audit history." /></div>
          {listQuery.isLoading ? <p className="px-5 pb-6 text-sm text-[#73685f]">Loading expenses…</p> : null}
          {items.length === 0 && !listQuery.isLoading ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No expenses recorded.</p> : null}
          {items.length > 0 ? (
            <table className="premium-table min-w-[760px] text-left text-[12px]">
              <thead><tr><th className="px-5 pb-3">Category</th><th className="px-5 pb-3">Method</th><th className="px-5 pb-3">Date</th><th className="px-5 pb-3 text-right">Amount</th><th className="px-5 pb-3 text-right">Status</th><th className="px-5 pb-3 text-right">Action</th></tr></thead>
              <tbody>
                {items.map((expense) => (
                  <tr key={expense.id}>
                    <td className="px-5 py-3 font-semibold text-[#2a241f]">{expense.category}</td>
                    <td className="px-5 py-3 text-[#73685f]">{methodLabel(expense.method)}</td>
                    <td className="font-data px-5 py-3 text-[#73685f]">{new Date(expense.expenseDate).toLocaleDateString("en-PH")}</td>
                    <td className="font-data px-5 py-3 text-right font-medium">₱{money(expense.amountMinor)}</td>
                    <td className="px-5 py-3 text-right"><StatusPill tone={expense.voidedAt ? "warn" : "ok"}>{expense.voidedAt ? "Voided" : "Recorded"}</StatusPill></td>
                    <td className="px-5 py-3 text-right">{voidable && !expense.voidedAt ? <DangerButton type="button" onClick={() => { setVoidTarget(expense); setVoidReason(""); setError(null); }}>Void</DangerButton> : <span className="text-[11px] text-[#9a8d83]">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </DataTableFrame>
        <RequestError error={listQuery.isError ? listQuery.error : null} fallback="Could not load expenses." />
      </main>

      <Modal
        open={createOpen}
        onClose={() => !busy && setCreateOpen(false)}
        title="Record expense"
        description="Record actual operating spend. Cash expenses participate in shift cash accounting when applicable."
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="expense-create-form" disabled={busy || !category.trim() || !amount.trim()}>{busy ? "Recording…" : "Record expense"}</PrimaryButton></div>}
      >
        <form id="expense-create-form" noValidate onSubmit={(event) => void createExpense(event)} className="grid gap-4 sm:grid-cols-2">
          <label className="text-[11px] font-semibold text-[#655b53]">Category<input autoFocus value={category} onChange={(event) => setCategory(event.target.value)} required placeholder="Transport" className="field mt-1.5" /></label>
          <label className="text-[11px] font-semibold text-[#655b53]">Amount (PHP)<input value={amount} onChange={(event) => setAmount(event.target.value)} required inputMode="decimal" placeholder="0.00" className="field mt-1.5" /></label>
          <label className="text-[11px] font-semibold text-[#655b53]">Method<select value={method} onChange={(event) => setMethod(event.target.value)} className="field mt-1.5">{METHODS.map((value) => <option key={value} value={value}>{methodLabel(value)}</option>)}</select></label>
          <label className="text-[11px] font-semibold text-[#655b53] sm:col-span-2">Description (optional)<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="field mt-1.5 resize-none" placeholder="Purpose or vendor" /></label>
          <div className="sm:col-span-2"><RequestError error={error} fallback="Create failed" /></div>
        </form>
      </Modal>

      <Modal
        open={voidTarget !== null}
        onClose={() => !busy && setVoidTarget(null)}
        title="Void expense"
        description="Voiding preserves the original expense for audit history and records a compensating state change."
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setVoidTarget(null)} disabled={busy}>Cancel</GhostButton><DangerButton type="button" onClick={() => void voidExpense()} disabled={busy || !voidReason.trim()}>{busy ? "Voiding…" : "Void expense"}</DangerButton></div>}
      >
        <div className="space-y-4">
          {voidTarget ? <div className="rounded-xl border border-[#eee4db] bg-white p-4"><p className="font-semibold text-[#2a241f]">{voidTarget.category}</p><p className="font-data mt-1 text-sm text-[#73685f]">₱{money(voidTarget.amountMinor)}</p></div> : null}
          <label className="block text-[11px] font-semibold text-[#655b53]">Reason<input autoFocus value={voidReason} onChange={(event) => setVoidReason(event.target.value)} required className="field mt-1.5" placeholder="Why this expense must be voided" /></label>
          <RequestError error={error} fallback="Void failed" />
        </div>
      </Modal>
    </AppShell>
  );
}
