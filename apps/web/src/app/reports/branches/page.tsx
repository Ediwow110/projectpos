"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { money } from "../../../lib/reports";

interface BranchRow {
  branchId: string | null;
  name: string;
  type: string;
  sales: number;
  orders: number;
  margin: number | null;
}

interface BranchesPayload {
  rows: BranchRow[];
  compareLabel: string;
}

export default function BranchesReportPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["report-branches"],
    queryFn: () => apiFetch<BranchesPayload>("/api/v1/reports/branches?compare=none"),
    retry: false,
  });

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Branch comparison</h1>
      {query.isLoading && <p>Loading…</p>}
      {query.isError && (
        <p role="alert">
          {query.error instanceof ApiError ? query.error.code + ": " + query.error.message : "Could not load report."}
        </p>
      )}
      {query.data && query.data.rows.length === 0 && <p>No branch activity in this period.</p>}
      {query.data && query.data.rows.length > 0 && (
        <table>
          <thead><tr><th>Branch</th><th>Type</th><th>Sales</th><th>Orders</th><th>Margin</th></tr></thead>
          <tbody>
            {query.data.rows.map((r) => (
              <tr key={r.branchId ?? "unscoped"} style={{ fontVariantNumeric: "tabular-nums" }}>
                <td>{r.name}</td>
                <td>{r.type}</td>
                <td>{money(r.sales)}</td>
                <td>{r.orders}</td>
                <td>{r.margin === null ? "—" : money(r.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
