"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { money } from "../../../lib/reports";

interface CashPayload {
  shifts: Array<{
    shiftId: string;
    registerId: string;
    status: string;
    expectedCash: number;
    countedCash: number | null;
    variance: number | null;
  }>;
}

export default function CashReportPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["report-cash"],
    queryFn: () => apiFetch<CashPayload>("/api/v1/reports/cash?compare=none"),
    retry: false,
  });

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Cash report</h1>
      {query.isLoading && <p>Loading…</p>}
      {query.isError && (
        <p role="alert">
          {query.error instanceof ApiError ? query.error.code + ": " + query.error.message : "Could not load report."}
        </p>
      )}
      {query.data && query.data.shifts.length === 0 && <p>No shifts recorded.</p>}
      {query.data && (
        <table>
          <thead><tr><th>Shift</th><th>Status</th><th>Expected</th><th>Counted</th><th>Variance</th></tr></thead>
          <tbody>
            {query.data.shifts.map((s) => (
              <tr key={s.shiftId} style={{ fontVariantNumeric: "tabular-nums" }}>
                <td><Link href={"/shifts/" + s.shiftId}>Shift {s.shiftId.slice(0, 8)}</Link></td>
                <td>{s.status}</td>
                <td>{money(s.expectedCash)}</td>
                <td>{s.countedCash === null ? "OPEN — not counted" : money(s.countedCash)}</td>
                <td>{s.variance === null ? "—" : money(s.variance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
