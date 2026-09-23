"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { money } from "../../../lib/reports";

interface CustomersPayload {
  total: number;
  active: number;
  top: Array<{ customerId: string; name: string; spend: number; orders: number }>;
}

export default function CustomersReportPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["report-customers"],
    queryFn: () => apiFetch<CustomersPayload>("/api/v1/reports/customers?compare=none"),
    retry: false,
  });

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Customers report</h1>
      {query.isLoading && <p>Loading…</p>}
      {query.isError && (
        <p role="alert">
          {query.error instanceof ApiError ? query.error.code + ": " + query.error.message : "Could not load report."}
        </p>
      )}
      {query.data && (
        <>
          <p style={{ fontVariantNumeric: "tabular-nums" }}>
            Total customers: {query.data.total} — Active: {query.data.active}
          </p>
          <h2>Top customers by spend</h2>
          {query.data.top.length === 0 && <p>No customer purchases in range.</p>}
          <table>
            <thead><tr><th>Customer</th><th>Spend</th><th>Orders</th></tr></thead>
            <tbody>
              {query.data.top.map((c) => (
                <tr key={c.customerId} style={{ fontVariantNumeric: "tabular-nums" }}>
                  <td><Link href={"/customers/" + c.customerId}>{c.name}</Link></td>
                  <td>{money(c.spend)}</td><td>{c.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
