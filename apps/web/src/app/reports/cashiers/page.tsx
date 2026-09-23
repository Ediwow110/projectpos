"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { money } from "../../../lib/reports";

interface CashiersPayload {
  actors: Array<{
    actorId: string;
    name: string;
    sales: number;
    orders: number;
    refunds: number;
    refundTotal: number;
    discounts: number;
    varianceContext: { shiftsClosed: number; totalVariance: number };
  }>;
}

export default function CashiersReportPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["report-cashiers"],
    queryFn: () => apiFetch<CashiersPayload>("/api/v1/reports/cashiers?compare=none"),
    retry: false,
  });

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Cashiers report</h1>
      <p>Operational context per staff member — not a ranking.</p>
      {query.isLoading && <p>Loading…</p>}
      {query.isError && (
        <p role="alert">
          {query.error instanceof ApiError
            ? query.error.code + ": " + query.error.message
            : "Could not load report."}
        </p>
      )}
      {query.data && query.data.actors.length === 0 && <p>No staff activity in range.</p>}
      {query.data && (
        <table>
          <thead>
            <tr><th>Staff</th><th>Sales</th><th>Orders</th><th>Refunds</th><th>Refund total</th><th>Discounts</th><th>Shifts closed</th><th>Cash variance</th></tr>
          </thead>
          <tbody>
            {query.data.actors.map((a) => (
              <tr key={a.actorId} style={{ fontVariantNumeric: "tabular-nums" }}>
                <td>{a.name}</td><td>{money(a.sales)}</td><td>{a.orders}</td>
                <td>{a.refunds}</td><td>{money(a.refundTotal)}</td><td>{money(a.discounts)}</td>
                <td>{a.varianceContext.shiftsClosed}</td><td>{money(a.varianceContext.totalVariance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
