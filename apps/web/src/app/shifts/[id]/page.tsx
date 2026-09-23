"use client";

import type { JSX } from "react";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { money, varianceLabel } from "../../../lib/shifts";

interface MovementRow {
  id: string;
  type: string;
  amountMinor: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string;
}

interface ShiftReport {
  shift: {
    id: string;
    status: string;
    openedBy: string;
    closedBy: string | null;
    openingFloatMinor: number;
  };
  components: {
    openingFloat: number;
    cashSales: number;
    cashRefunds: number;
    cashExpenses: number;
    cashDeposits: number;
    cashWithdrawals: number;
    adjustments: number;
    expectedCash: number;
    countedCash: number | null;
    variance: number | null;
  };
  movements: MovementRow[];
}

export default function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const reportQuery = useQuery({
    queryKey: ["shift", id],
    queryFn: () => apiFetch<ShiftReport>("/api/v1/shifts/" + id),
    retry: false,
  });

  if (reportQuery.isLoading) return <main>Loading shift…</main>;
  if (reportQuery.isError)
    return (
      <main>
        <p role="alert">
          {reportQuery.error instanceof ApiError
            ? reportQuery.error.code + ": " + reportQuery.error.message
            : "Shift not found."}
        </p>
        <Link href="/shifts">Back to shifts</Link>
      </main>
    );
  if (!reportQuery.data)
    return (
      <main>
        <p role="alert">Shift not found.</p>
        <Link href="/shifts">Back to shifts</Link>
      </main>
    );

  const { shift, components: c, movements } = reportQuery.data;
  return (
    <main>
      <Link href="/shifts">Back to shifts</Link>
      <h1>Shift report</h1>
      <p>Status: {shift.status}</p>
      <dl style={{ fontVariantNumeric: "tabular-nums" }}>
        <div><dt>Opening float</dt><dd>{money(c.openingFloat)}</dd></div>
        <div><dt>Cash sales</dt><dd>{money(c.cashSales)}</dd></div>
        <div><dt>Cash refunds</dt><dd>{money(c.cashRefunds)}</dd></div>
        <div><dt>Paid out</dt><dd>{money(c.cashExpenses)}</dd></div>
        <div><dt>Deposits</dt><dd>{money(c.cashDeposits)}</dd></div>
        <div><dt>Withdrawals</dt><dd>{money(c.cashWithdrawals)}</dd></div>
        <div><dt>Adjustments</dt><dd>{money(c.adjustments)}</dd></div>
        <div><dt>Expected cash</dt><dd>{money(c.expectedCash)}</dd></div>
        <div><dt>Counted cash</dt><dd>{c.countedCash === null ? "—" : money(c.countedCash)}</dd></div>
        <div>
          <dt>Variance</dt>
          <dd><strong>{c.variance === null ? "OPEN — not yet counted" : varianceLabel(c.variance)}</strong></dd>
        </div>
      </dl>
      <h2>Cash movements</h2>
      {movements.length === 0 && <p>No movements recorded.</p>}
      <ol>
        {movements.map((m) => (
          <li key={m.id} style={{ fontVariantNumeric: "tabular-nums" }}>
            {m.type}: {money(m.amountMinor)}
            {m.reason ? " — " + m.reason : ""}
            {m.referenceType === "Sale" && m.referenceId ? (
              <> — <Link href={"/receipts/" + m.referenceId}>receipt</Link></>
            ) : null}
          </li>
        ))}
      </ol>
    </main>
  );
}
