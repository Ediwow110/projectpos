"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";

interface Me {
  role: string;
}

interface SaleRow {
  id: string;
  receiptNo: string;
  status: string;
  totalMinor: number;
  customerName: string | null;
}

interface SalesPage {
  items: SaleRow[];
  nextCursor: string | null;
}

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export default function SalesHistoryPage(): JSX.Element {
  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });

  function queryString(next?: string): string {
    const sp = new URLSearchParams();
    sp.set("limit", "20");
    if (status !== "") sp.set("status", status);
    if (customerId.trim() !== "") sp.set("customerId", customerId.trim());
    if (dateFrom !== "") sp.set("dateFrom", dateFrom);
    if (dateTo !== "") sp.set("dateTo", dateTo);
    if (next) sp.set("cursor", next);
    return "/api/v1/sales?" + sp.toString();
  }

  const listQuery = useQuery({
    queryKey: ["sales", status, customerId, dateFrom, dateTo, cursor],
    queryFn: () => apiFetch<SalesPage>(queryString(cursor)),
    retry: false,
  });

  function downloadExport(): void {
    setError("");
    const sp = new URLSearchParams();
    sp.set("format", "csv");
    if (status !== "") sp.set("status", status);
    if (customerId.trim() !== "") sp.set("customerId", customerId.trim());
    if (dateFrom !== "") sp.set("dateFrom", dateFrom);
    if (dateTo !== "") sp.set("dateTo", dateTo);
    window.location.href = "/api/v1/sales/export?" + sp.toString();
  }

  const role = meQuery.data?.role ?? "cashier";
  const canExport = role === "owner" || role === "manager" || role === "inventory";

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Sales history</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setCursor(undefined);
          void listQuery.refetch();
        }}
      >
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="COMPLETED">Completed</option>
            <option value="PARTIALLY_REFUNDED">Partially refunded</option>
            <option value="REFUNDED">Refunded</option>
            <option value="REFUND_REQUESTED">Refund requested</option>
            <option value="VOIDED">Voided</option>
          </select>
        </label>
        <label>
          Customer ID
          <input value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="Optional" />
        </label>
        <label>
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <button type="submit">Filter</button>
        {canExport && (
          <button type="button" onClick={downloadExport}>
            Export CSV
          </button>
        )}
      </form>
      {listQuery.isLoading && <p>Loading sales…</p>}
      {listQuery.isError && (
        <p role="alert">
          {listQuery.error instanceof ApiError
            ? listQuery.error.code + ": " + listQuery.error.message
            : "Could not load sales."}
        </p>
      )}
      {listQuery.data && listQuery.data.items.length === 0 && <p>No sales match these filters.</p>}
      <ul>
        {(listQuery.data?.items ?? []).map((s) => (
          <li key={s.id} style={{ fontVariantNumeric: "tabular-nums" }}>
            <Link href={"/sales/" + s.id}>{s.receiptNo}</Link> — {s.status} — {money(s.totalMinor)}
            {s.customerName ? " — " + s.customerName : ""}
          </li>
        ))}
      </ul>
      {listQuery.data?.nextCursor && (
        <button onClick={() => setCursor(listQuery.data!.nextCursor!)}>Next page</button>
      )}
      {error !== "" && <p role="alert">{error}</p>}
    </main>
  );
}
