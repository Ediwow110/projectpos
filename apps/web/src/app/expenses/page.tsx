"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { canVoidExpense } from "../../lib/expenses";

interface Me {
  role: string;
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
  return (minor / 100).toFixed(2);
}

export default function ExpensesPage(): JSX.Element {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [description, setDescription] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [error, setError] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const listQuery = useQuery({
    queryKey: ["expenses", filterCategory],
    queryFn: () => apiFetch<{ items: ExpenseRow[]; total: number }>(
      "/api/v1/expenses?" +
        new URLSearchParams({
          ...(filterCategory.trim() !== "" ? { category: filterCategory.trim() } : {}),
          page: "1",
          pageSize: "20",
        }).toString(),
    ),
    retry: false,
  });

  const voidable = canVoidExpense(meQuery.data?.role ?? "cashier");
  const exportable = meQuery.data !== undefined && ["owner", "manager", "inventory"].includes(meQuery.data.role);

  async function create(): Promise<void> {
    setError("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/expenses", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            category: category.trim(),
            amountMinor: Math.round(Number(amount) * 100),
            method,
            ...(description.trim() !== "" ? { description: description.trim() } : {}),
          }),
        },
      });
      setCategory("");
      setAmount("");
      setDescription("");
      await listQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Create failed");
    }
  }

  async function voidExpense(id: string): Promise<void> {
    setError("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/expenses/" + id + "/void", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ reason: "voided from expenses page" }) },
      });
      await listQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Void failed");
    }
  }

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Expenses</h1>
      <section aria-label="Record expense">
        <h2>Record expense</h2>
        <label>
          Category
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ice, transport" />
        </label>
        <label>
          Amount
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Description (optional)
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <button onClick={() => void create()} disabled={category.trim() === "" || amount.trim() === ""}>
          Record expense
        </button>
      </section>
      <section aria-label="Expense list">
        <h2>Expenses</h2>
        <label>
          Filter by category
          <input value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} />
        </label>
        {exportable && <a href="/api/v1/expenses/export?format=csv">Export CSV</a>}
        {listQuery.data && listQuery.data.items.length === 0 && <p>No expenses recorded.</p>}
        <ul>
          {(listQuery.data?.items ?? []).map((e) => (
            <li key={e.id} style={{ fontVariantNumeric: "tabular-nums" }}>
              {e.category} — {money(e.amountMinor)} ({e.method})
              {e.voidedAt ? " — VOIDED" : ""}
              {voidable && !e.voidedAt && (
                <button onClick={() => void voidExpense(e.id)}>Void</button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {error !== "" && <p role="alert">{error}</p>}
    </main>
  );
}
