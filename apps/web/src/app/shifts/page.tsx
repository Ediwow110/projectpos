"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { money, varianceLabel } from "../../lib/shifts";

interface Csrf {
  csrfToken: string;
}

interface RegisterRow {
  id: string;
  name: string;
  isActive: boolean;
}

interface ShiftRow {
  id: string;
  registerId: string;
  branchId: string | null;
  status: string;
  openedBy: string;
  openingFloatMinor: number;
  countedCashMinor: number | null;
  varianceMinor: number | null;
  expectedCashMinor: number;
}

interface BranchRow {
  id: string;
  name: string;
}

const KINDS = ["paid_out", "cash_deposit", "cash_withdrawal", "adjustment"];

export default function ShiftsPage(): JSX.Element {
  const [registerId, setRegisterId] = useState("");
  const [openingFloat, setOpeningFloat] = useState("");
  const [kind, setKind] = useState("paid_out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [counted, setCounted] = useState("");
  const [status, setStatus] = useState("");

  const registersQuery = useQuery({
    queryKey: ["registers"],
    queryFn: () => apiFetch<{ items: RegisterRow[] }>("/api/v1/registers"),
    retry: false,
  });
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"),
    retry: false,
  });
  const openQuery = useQuery({
    queryKey: ["shifts-open"],
    queryFn: () => apiFetch<{ items: ShiftRow[] }>("/api/v1/shifts?status=OPEN&limit=50"),
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ["shifts-history"],
    queryFn: () => apiFetch<{ items: ShiftRow[] }>("/api/v1/shifts?limit=20"),
    retry: false,
  });

  async function mutate(path: string, init: RequestInit): Promise<{ id: string } & Record<string, unknown>> {
    const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
    const out = await apiFetch<{ id: string } & Record<string, unknown>>(path, {
      csrfToken: csrf.csrfToken,
      init,
    });
    await openQuery.refetch();
    await historyQuery.refetch();
    return out;
  }

  async function openShift(): Promise<void> {
    setStatus("");
    try {
      const floatMinor = openingFloat.trim() === "" ? 0 : Math.round(Number(openingFloat) * 100);
      await mutate("/api/v1/registers/" + registerId + "/open", {
        method: "POST",
        body: JSON.stringify({ registerId, openingFloatMinor: floatMinor }),
      });
      setStatus("Shift opened.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Open failed");
    }
  }

  async function recordCash(shiftId: string): Promise<void> {
    setStatus("");
    try {
      await mutate("/api/v1/shifts/" + shiftId + "/cash", {
        method: "POST",
        body: JSON.stringify({ kind, amountMinor: Math.round(Number(amount) * 100), reason }),
      });
      setAmount("");
      setReason("");
      setStatus("Cash movement recorded.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Cash record failed");
    }
  }

  async function closeShift(shiftId: string): Promise<void> {
    setStatus("");
    try {
      const out = await mutate("/api/v1/shifts/" + shiftId + "/close", {
        method: "POST",
        body: JSON.stringify({ countedCashMinor: Math.round(Number(counted) * 100) }),
      });
      const report = (out as { report?: { variance?: number } }).report;
      setStatus(
        "Shift closed. Variance: " +
          (typeof report?.variance === "number" ? varianceLabel(report.variance) : "unknown"),
      );
      setCounted("");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Close failed");
    }
  }

  const registers = (registersQuery.data?.items ?? []).filter((r) => r.isActive);
  const openShifts = openQuery.data?.items ?? [];
  const branchName = (branchId: string | null | undefined): string =>
    branchId == null
      ? "No branch"
      : (branchesQuery.data?.items ?? []).find((b) => b.id === branchId)?.name ?? "Unknown branch";

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Shifts</h1>
      <section aria-label="Open shift">
        <h2>Open shift</h2>
        <label>
          Register
          <select value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
            <option value="">Select register</option>
            {registers.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label>
          Opening float
          <input
            value={openingFloat}
            onChange={(e) => setOpeningFloat(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
          />
        </label>
        <button onClick={() => void openShift()} disabled={registerId === ""}>
          Open shift
        </button>
      </section>
      <section aria-label="Active shifts">
        <h2>Active shifts</h2>
        {openShifts.length === 0 && <p>No open shifts.</p>}
        {openShifts.map((s) => (
          <article key={s.id}>
            <h3>
              <Link href={"/shifts/" + s.id}>Shift {s.id.slice(0, 8)}</Link>
            </h3>
            <p>Branch: {branchName(s.branchId)}</p>
            <p style={{ fontVariantNumeric: "tabular-nums" }}>
              Float: {money(s.openingFloatMinor)} — Expected: {money(s.expectedCashMinor)}
            </p>
            <div>
              <label>
                Kind
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                Reason
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required for paid out, withdrawals, adjustments" />
              </label>
              <button onClick={() => void recordCash(s.id)}>Record cash</button>
            </div>
            <div>
              <label>
                Counted cash
                <input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" />
              </label>
              <button onClick={() => void closeShift(s.id)}>Close shift</button>
            </div>
          </article>
        ))}
      </section>
      <section aria-label="History">
        <h2>Recent shifts</h2>
        <ul>
          {(historyQuery.data?.items ?? []).map((s) => (
            <li key={s.id} style={{ fontVariantNumeric: "tabular-nums" }}>
              <Link href={"/shifts/" + s.id}>Shift {s.id.slice(0, 8)}</Link> — {s.status} —{" "}
              {branchName(s.branchId)}
              {s.varianceMinor !== null && s.varianceMinor !== undefined
                ? " — " + varianceLabel(s.varianceMinor)
                : ""}
            </li>
          ))}
        </ul>
      </section>
      {status !== "" && <p role="status">{status}</p>}
    </main>
  );
}
