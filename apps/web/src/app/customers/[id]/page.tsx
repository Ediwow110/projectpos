"use client";

import type { JSX } from "react";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";

interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  purchaseHistory: Array<{ id: string; receiptNo: string; status: string; totalMinor: number }>;
}

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const detailQuery = useQuery({
    queryKey: ["customer", id],
    queryFn: () => apiFetch<CustomerDetail>("/api/v1/customers/" + id),
    retry: false,
  });

  if (detailQuery.isLoading) return <main>Loading customer…</main>;
  if (detailQuery.isError)
    return (
      <main>
        <p role="alert">
          {detailQuery.error instanceof ApiError
            ? detailQuery.error.code + ": " + detailQuery.error.message
            : "Customer not found."}
        </p>
        <Link href="/customers">Back to customers</Link>
      </main>
    );
  if (!detailQuery.data)
    return (
      <main>
        <p role="alert">Customer not found.</p>
        <Link href="/customers">Back to customers</Link>
      </main>
    );

  const c = detailQuery.data;
  return (
    <main>
      <Link href="/customers">Back to customers</Link>
      <h1>{c.name}</h1>
      <dl>
        <div><dt>Phone</dt><dd>{c.phone ?? "—"}</dd></div>
        <div><dt>Email</dt><dd>{c.email ?? "—"}</dd></div>
        <div><dt>Address</dt><dd>{c.address ?? "—"}</dd></div>
        <div><dt>Notes</dt><dd>{c.notes ?? "—"}</dd></div>
        <div><dt>Status</dt><dd>{c.isActive ? "Active" : "Archived"}</dd></div>
      </dl>
      <section aria-label="Purchase history">
        <h2>Purchase history</h2>
        {c.purchaseHistory.length === 0 && <p>No purchases recorded.</p>}
        <ul>
          {c.purchaseHistory.map((s) => (
            <li key={s.id} style={{ fontVariantNumeric: "tabular-nums" }}>
              <Link href={"/sales/" + s.id}>{s.receiptNo}</Link> — {s.status} — {money(s.totalMinor)}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
