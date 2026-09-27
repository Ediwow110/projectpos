"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { DangerButton, PrimaryButton } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { transferStatusLabel } from "../../../lib/branches";
import type { BranchRow } from "../../branches/page";

interface Me {
  role: string;
  businessName?: string;
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

interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
}

type TransferAction = "dispatch" | "receive" | "cancel";
const ADJUST_ROLES = new Set(["owner", "manager", "inventory"]);

function statusTone(status: string): "ok" | "warn" | "bad" | "info" {
  if (status === "RECEIVED") return "ok";
  if (status === "IN_TRANSIT") return "info";
  if (status === "CANCELLED") return "bad";
  return "warn";
}

export default function TransferDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [statusMessage, setStatusMessage] = useState("");
  const [actionTarget, setActionTarget] = useState<TransferAction | null>(null);
  const [busy, setBusy] = useState(false);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const branchesQuery = useQuery({ queryKey: ["branches"], queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"), retry: false });
  const productsQuery = useQuery({ queryKey: ["transfer-products-all"], queryFn: () => apiFetch<{ items: ProductOption[] }>("/api/v1/products?active=all&page=1&pageSize=100"), retry: false });
  const detailQuery = useQuery({ queryKey: ["transfer", id], queryFn: () => apiFetch<TransferDetail>(`/api/v1/transfers/${id}`), retry: false });

  const lineIds = (detailQuery.data?.lines ?? []).map((line) => line.productId).join(",");
  const trailQuery = useQuery({
    queryKey: ["transfer-trail", id, lineIds],
    queryFn: async () => {
      const out: Movement[] = [];
      for (const line of detailQuery.data?.lines ?? []) {
        const page = await apiFetch<{ items: Movement[] }>(`/api/v1/inventory/products/${line.productId}/movements?pageSize=100`);
        for (const movement of page.items) {
          if (movement.referenceId === id && (movement.type === "transfer_out" || movement.type === "transfer_in")) out.push(movement);
        }
      }
      return out;
    },
    retry: false,
    enabled: detailQuery.data !== undefined,
  });

  const canAdjust = ADJUST_ROLES.has(meQuery.data?.role ?? "cashier");
  const branches = branchesQuery.data?.items ?? [];
  const products = productsQuery.data?.items ?? [];
  const branchName = (branchId: string): string => branches.find((branch) => branch.id === branchId)?.name ?? branchId.slice(0, 8);
  const productName = (productId: string): string => products.find((product) => product.id === productId)?.name ?? productId.slice(0, 8);
  const detail = detailQuery.data;
  const trail = trailQuery.data ?? [];
  const outMoves = trail.filter((movement) => movement.type === "transfer_out");
  const inMoves = trail.filter((movement) => movement.type === "transfer_in");

  async function act(action: TransferAction): Promise<void> {
    setStatusMessage("");
    setBusy(true);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/transfers/${id}/${action}`, {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({}) },
      });
      await detailQuery.refetch();
      await trailQuery.refetch();
      setStatusMessage(`Transfer ${action} completed.`);
      setActionTarget(null);
    } catch (err) {
      setStatusMessage(err instanceof ApiError ? `${err.code}: ${err.message}` : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (detailQuery.isError) {
    return <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}><main className="mx-auto max-w-[1240px] p-6"><Panel className="border-[#efb9b9] bg-[#fff0f0] p-6"><p role="alert" className="text-sm font-medium text-[#c43e3e]">Could not load transfer.</p><Link href="/transfers" className="mt-3 inline-block text-sm font-semibold text-[#e44e34]">← Back to transfers</Link></Panel></main></AppShell>;
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Inventory / Transfer detail"
          title={detail ? `${branchName(detail.fromBranchId)} → ${branchName(detail.toBranchId)}` : "Transfer"}
          description="Review the transfer lines and the stock ledger evidence created by dispatch and receive actions."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/transfers" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Transfers</Link>
              {canAdjust && detail?.status === "DRAFT" ? <PrimaryButton type="button" onClick={() => setActionTarget("dispatch")}>Dispatch</PrimaryButton> : null}
              {canAdjust && detail?.status === "IN_TRANSIT" ? <PrimaryButton type="button" onClick={() => setActionTarget("receive")}>Receive</PrimaryButton> : null}
              {canAdjust && detail && (detail.status === "DRAFT" || detail.status === "IN_TRANSIT") ? <DangerButton type="button" onClick={() => setActionTarget("cancel")}>Cancel transfer</DangerButton> : null}
            </div>
          }
        />

        {detail ? (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Transfer summary">
            <MetricCard label="Status" value={<span className="text-base">{transferStatusLabel(detail.status)}</span>} icon="↔" tone={statusTone(detail.status) === "bad" ? "warning" : statusTone(detail.status) === "ok" ? "success" : "info"} meta={`Transfer ${detail.id.slice(0, 8)}`} />
            <MetricCard label="Lines" value={detail.lines.length} icon="▦" meta="Distinct transfer rows" />
            <MetricCard label="Source movements" value={outMoves.length} icon="−" tone={outMoves.length ? "warning" : "info"} meta="Ledger evidence" />
            <MetricCard label="Destination movements" value={inMoves.length} icon="+" tone={inMoves.length ? "success" : "info"} meta="Ledger evidence" />
          </section>
        ) : null}

        {statusMessage ? <div role="status" className="rounded-xl border border-[#eadfd6] bg-white px-4 py-3 text-sm font-medium text-[#655b53]">{statusMessage}</div> : null}

        {detail ? (
          <DataTableFrame>
            <div className="px-5 py-4"><SectionHeader title="Transfer lines" description="The transfer quantity is fixed by the draft. Inventory changes occur through the workflow actions above." /></div>
            <table className="premium-table min-w-[620px] text-left text-[12px]">
              <thead><tr><th className="px-5 pb-3">Product</th><th className="px-5 pb-3 text-right">Quantity</th><th className="px-5 pb-3 text-right">Source moved</th><th className="px-5 pb-3 text-right">Destination moved</th></tr></thead>
              <tbody>
                {detail.lines.map((line) => {
                  const sourceMoved = outMoves.filter((movement) => movement.productId === line.productId).reduce((sum, movement) => sum + Math.abs(movement.qtyDelta), 0);
                  const destinationMoved = inMoves.filter((movement) => movement.productId === line.productId).reduce((sum, movement) => sum + movement.qtyDelta, 0);
                  return (
                    <tr key={line.productId}>
                      <td className="px-5 py-3 font-semibold text-[#2a241f]">{productName(line.productId)}</td>
                      <td className="font-data px-5 py-3 text-right">{line.qty}</td>
                      <td className="font-data px-5 py-3 text-right text-[#73685f]">{sourceMoved || "—"}</td>
                      <td className="font-data px-5 py-3 text-right text-[#73685f]">{destinationMoved || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTableFrame>
        ) : <Panel className="p-6 text-sm text-[#73685f]">Loading transfer…</Panel>}

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="p-5"><SectionHeader title={`Source ledger · ${detail ? branchName(detail.fromBranchId) : "—"}`} description="Stock leaves the source only when dispatch succeeds." /><div className="mt-4 space-y-2">{outMoves.length === 0 ? <p className="text-sm text-[#8b8077]">No stock has left the source yet.</p> : outMoves.map((movement) => <div key={movement.id} className="flex items-center justify-between rounded-xl bg-[#f7f1ea] px-3 py-2 text-sm"><span>{productName(movement.productId)}</span><span className="font-data font-semibold text-[#c43e3e]">{movement.qtyDelta}</span></div>)}</div></Panel>
          <Panel className="p-5"><SectionHeader title={`Destination ledger · ${detail ? branchName(detail.toBranchId) : "—"}`} description="Stock arrives only when receive succeeds." /><div className="mt-4 space-y-2">{inMoves.length === 0 ? <p className="text-sm text-[#8b8077]">Nothing has arrived at the destination yet.</p> : inMoves.map((movement) => <div key={movement.id} className="flex items-center justify-between rounded-xl bg-[#f7f1ea] px-3 py-2 text-sm"><span>{productName(movement.productId)}</span><span className="font-data font-semibold text-[#1f8a5b]">+{movement.qtyDelta}</span></div>)}</div></Panel>
        </div>
      </main>

      <ConfirmDialog
        open={actionTarget !== null}
        onCancel={() => !busy && setActionTarget(null)}
        onConfirm={() => actionTarget && void act(actionTarget)}
        busy={busy}
        tone={actionTarget === "cancel" ? "danger" : "primary"}
        title={actionTarget === "dispatch" ? "Dispatch transfer?" : actionTarget === "receive" ? "Receive transfer?" : "Cancel transfer?"}
        description={actionTarget === "dispatch" ? "Dispatch writes stock-out ledger movements at the source branch. This should only be done when the goods actually leave." : actionTarget === "receive" ? "Receive writes stock-in ledger movements at the destination branch. Confirm only after the goods have arrived." : "Cancel stops this transfer workflow. Existing ledger effects are handled by the backend transfer rules."}
        confirmLabel={actionTarget === "dispatch" ? "Dispatch transfer" : actionTarget === "receive" ? "Receive transfer" : "Cancel transfer"}
        details={detail ? <span><strong className="text-[#2a241f]">{branchName(detail.fromBranchId)}</strong> → <strong className="text-[#2a241f]">{branchName(detail.toBranchId)}</strong> · {detail.lines.length} line(s)</span> : null}
      />
    </AppShell>
  );
}
