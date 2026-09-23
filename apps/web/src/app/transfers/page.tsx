"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { transferStatusLabel } from "../../lib/branches";
import type { BranchRow } from "../branches/page";

interface TransferLine {
  productId: string;
  qty: number;
}

interface TransferRow {
  id: string;
  fromBranchId: string;
  toBranchId: string;
  status: string;
  lines: TransferLine[];
}

const STATUSES = ["", "DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];

export default function TransfersPage(): JSX.Element {
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [lines, setLines] = useState<TransferLine[]>([{ productId: "", qty: 1 }]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"),
    retry: false,
  });
  const listQuery = useQuery({
    queryKey: ["transfers", status],
    queryFn: () =>
      apiFetch<{ items: TransferRow[] }>(
        status === "" ? "/api/v1/transfers" : `/api/v1/transfers?status=${status}`,
      ),
    retry: false,
  });

  const branches = branchesQuery.data?.items ?? [];
  const branchName = (id: string): string => branches.find((b) => b.id === id)?.name ?? id.slice(0, 8);

  async function createTransfer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/transfers", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            fromBranchId,
            toBranchId,
            lines: lines
              .filter((l) => l.productId.trim() !== "" && l.qty > 0)
              .map((l) => ({ productId: l.productId.trim(), qty: Math.floor(l.qty) })),
          }),
        },
      });
      setLines([{ productId: "", qty: 1 }]);
      await listQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Creation failed");
    }
  }

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Stock transfers</h1>
      <section aria-label="Create transfer">
        <h2>New transfer</h2>
        <form onSubmit={(e) => void createTransfer(e)}>
          <label>
            From
            <select value={fromBranchId} onChange={(e) => setFromBranchId(e.target.value)}>
              <option value="">Select source</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <label>
            To
            <select value={toBranchId} onChange={(e) => setToBranchId(e.target.value)}>
              <option value="">Select destination</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          {lines.map((l, i) => (
            <div key={i}>
              <label>
                Product ID
                <input
                  value={l.productId}
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))
                  }
                  placeholder="Product ID"
                />
              </label>
              <label>
                Qty
                <input
                  type="number"
                  min={1}
                  value={l.qty}
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))
                  }
                />
              </label>
            </div>
          ))}
          <button type="button" onClick={() => setLines([...lines, { productId: "", qty: 1 }])}>
            Add line
          </button>
          <button type="submit" disabled={fromBranchId === "" || toBranchId === ""}>
            Create transfer
          </button>
        </form>
      </section>
      <section aria-label="Transfer list">
        <h2>Transfers</h2>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === "" ? "All" : transferStatusLabel(s)}</option>
            ))}
          </select>
        </label>
        {listQuery.isLoading && <p>Loading transfers…</p>}
        {listQuery.data?.items.length === 0 && <p>No transfers match this filter.</p>}
        <ul>
          {(listQuery.data?.items ?? []).map((t) => (
            <li key={t.id} style={{ fontVariantNumeric: "tabular-nums" }}>
              <Link href={"/transfers/" + t.id}>
                {branchName(t.fromBranchId)} → {branchName(t.toBranchId)}
              </Link>{" "}
              — {transferStatusLabel(t.status)} — {t.lines.length} line(s)
            </li>
          ))}
        </ul>
      </section>
      {error !== "" && <p role="alert">{error}</p>}
    </main>
  );
}
