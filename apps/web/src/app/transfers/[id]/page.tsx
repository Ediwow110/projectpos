"use client";

import type { JSX } from "react";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";
import { transferStatusLabel } from "../../../lib/branches";
import type { BranchRow } from "../../branches/page";

interface Me {
  role: string;
}

interface TransferDetail {
  id: string;
  fromBranchId: string;
  toBranchId: string;
  status: string;
  lines: Array<{ productId: string; qty: number }>;
}

interface Movement {
  id: string;
  productId: string;
  type: string;
  qtyDelta: number;
  branchId: string | null;
  referenceId: string | null;
}

const ADJUST_ROLES = new Set(["owner", "manager", "inventory"]);

export default function TransferDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [status, setStatus] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"),
    retry: false,
  });
  const detailQuery = useQuery({
    queryKey: ["transfer", id],
    queryFn: () => apiFetch<TransferDetail>(`/api/v1/transfers/${id}`),
    retry: false,
  });

  // Movement trail: per-line product histories filtered to this transfer.
  const lineIds = (detailQuery.data?.lines ?? []).map((l) => l.productId).join(",");
  const trailQuery = useQuery({
    queryKey: ["transfer-trail", id, lineIds],
    queryFn: async () => {
      const out: Movement[] = [];
      for (const line of detailQuery.data?.lines ?? []) {
        const page = await apiFetch<{ items: Movement[] }>(
          `/api/v1/inventory/products/${line.productId}/movements?pageSize=100`,
        );
        for (const m of page.items) {
          if (m.referenceId === id && (m.type === "transfer_out" || m.type === "transfer_in")) out.push(m);
        }
      }
      return out;
    },
    retry: false,
    enabled: detailQuery.data !== undefined,
  });

  const canAdjust = ADJUST_ROLES.has(meQuery.data?.role ?? "cashier");
  const branches = branchesQuery.data?.items ?? [];
  const branchName = (branchId: string): string =>
    branches.find((b) => b.id === branchId)?.name ?? branchId.slice(0, 8);
  const detail = detailQuery.data;
  const trail = trailQuery.data ?? [];
  const outMoves = trail.filter((m) => m.type === "transfer_out");
  const inMoves = trail.filter((m) => m.type === "transfer_in");

  async function act(action: "dispatch" | "receive" | "cancel"): Promise<void> {
    setStatus("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/transfers/${id}/${action}`, {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({}),
        },
      });
      await detailQuery.refetch();
      await trailQuery.refetch();
      setStatus(`Transfer ${action} completed.`);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Action failed");
    }
  }

  return (
    <main>
      <Link href="/transfers">Back to transfers</Link>
      <h1>Transfer {id.slice(0, 8)}</h1>
      {detailQuery.isLoading && <p>Loading transfer…</p>}
      {detailQuery.isError && <p role="alert">Could not load transfer.</p>}
      {detail && (
        <>
          <p style={{ fontVariantNumeric: "tabular-nums" }}>
            {branchName(detail.fromBranchId)} → {branchName(detail.toBranchId)} —{" "}
            {transferStatusLabel(detail.status)}
          </p>
          {canAdjust && (
            <div>
              {detail.status === "DRAFT" && (
                <button onClick={() => void act("dispatch")}>Dispatch</button>
              )}
              {detail.status === "IN_TRANSIT" && (
                <>
                  <button onClick={() => void act("receive")}>Receive</button>{" "}
                  <button onClick={() => void act("cancel")}>Cancel</button>
                </>
              )}
              {detail.status === "DRAFT" && (
                <> <button onClick={() => void act("cancel")}>Cancel</button></>
              )}
            </div>
          )}
          <section aria-label="Transfer ledger" style={{ display: "flex", gap: "2rem" }}>
            <div>
              <h2>Source — out ({branchName(detail.fromBranchId)})</h2>
              {outMoves.length === 0 && <p>No stock has left the source yet.</p>}
              <ul>
                {outMoves.map((m) => (
                  <li key={m.id} style={{ fontVariantNumeric: "tabular-nums" }}>
                    {m.productId.slice(0, 8)}: {m.qtyDelta}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2>Destination — in ({branchName(detail.toBranchId)})</h2>
              {inMoves.length === 0 && <p>Nothing has arrived at the destination yet.</p>}
              <ul>
                {inMoves.map((m) => (
                  <li key={m.id} style={{ fontVariantNumeric: "tabular-nums" }}>
                    {m.productId.slice(0, 8)}: +{m.qtyDelta}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}
      {status !== "" && <p role="status">{status}</p>}
    </main>
  );
}
