"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { BarChart } from "../../../lib/charts";
import { money } from "../../../lib/reports";

interface PaymentsPayload {
  byMethod: Array<{ method: string; total: number; count: number }>;
  unknown: number;
  refunded: number;
}

export default function PaymentsReportPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["report-payments"],
    queryFn: () => apiFetch<PaymentsPayload>("/api/v1/reports/payments?compare=none"),
    retry: false,
  });

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Payments report</h1>
      {query.isLoading && <p>Loading…</p>}
      {query.isError && (
        <p role="alert">
          {query.error instanceof ApiError ? query.error.code + ": " + query.error.message : "Could not load report."}
        </p>
      )}
      {query.data && (
        <>
          <BarChart bars={query.data.byMethod.map((m) => ({ label: m.method, value: m.total }))} />
          <table>
            <thead><tr><th>Method</th><th>Total</th><th>Count</th></tr></thead>
            <tbody>
              {query.data.byMethod.map((m) => (
                <tr key={m.method} style={{ fontVariantNumeric: "tabular-nums" }}>
                  <td>{m.method}</td><td>{money(m.total)}</td><td>{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontVariantNumeric: "tabular-nums" }}>
            Unknown (needs reconciliation): {query.data.unknown} — Refunded: {money(query.data.refunded)}
          </p>
        </>
      )}
    </main>
  );
}
