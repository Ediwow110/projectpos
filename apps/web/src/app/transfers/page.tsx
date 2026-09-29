"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { Modal } from "../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
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

interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
}

interface Me {
  role: string;
  businessName?: string;
}

const STATUSES = ["", "DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];
const ADJUST_ROLES = new Set(["owner", "manager", "inventory"]);

function statusTone(status: string): "ok" | "warn" | "bad" | "info" {
  if (status === "RECEIVED") return "ok";
  if (status === "IN_TRANSIT") return "info";
  if (status === "CANCELLED") return "bad";
  return "warn";
}

export default function TransfersPage(): JSX.Element {
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [lines, setLines] = useState<TransferLine[]>([{ productId: "", qty: 1 }]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const branchesQuery = useQuery({ queryKey: ["branches"], queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"), retry: false });
  const productsQuery = useQuery({
    queryKey: ["transfer-products"],
    queryFn: () => apiFetch<{ items: ProductOption[] }>("/api/v1/products?active=true&page=1&pageSize=100"),
    retry: false,
    enabled: createOpen,
  });
  const listQuery = useQuery({
    queryKey: ["transfers", status],
    queryFn: () => apiFetch<{ items: TransferRow[] }>(status ? `/api/v1/transfers?status=${status}` : "/api/v1/transfers"),
    retry: false,
  });

  const branches = branchesQuery.data?.items ?? [];
  const products = productsQuery.data?.items ?? [];
  const items = listQuery.data?.items ?? [];
  const canAdjust = ADJUST_ROLES.has(meQuery.data?.role ?? "cashier");
  const branchName = (id: string): string => branches.find((branch) => branch.id === id)?.name ?? id.slice(0, 8);
  const activeTransfers = items.filter((transfer) => transfer.status === "DRAFT" || transfer.status === "IN_TRANSIT").length;
  const receivedTransfers = items.filter((transfer) => transfer.status === "RECEIVED").length;
  const lineCount = items.reduce((sum, transfer) => sum + transfer.lines.length, 0);

  async function createTransfer(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setSuccess("");
    const validLines = lines.filter((line) => line.productId && Number.isInteger(line.qty) && line.qty > 0);
    if (!fromBranchId || !toBranchId || fromBranchId === toBranchId) {
      setError("VALIDATION: Source and destination must be different branches.");
      return;
    }
    if (validLines.length === 0) {
      setError("VALIDATION: Add at least one product with a quantity greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/transfers", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({ fromBranchId, toBranchId, lines: validLines.map((line) => ({ productId: line.productId, qty: Math.floor(line.qty) })) }),
        },
      });
      setLines([{ productId: "", qty: 1 }]);
      setFromBranchId("");
      setToBranchId("");
      setCreateOpen(false);
      setSuccess("Transfer draft created.");
      await listQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Creation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Inventory / Branch movement"
          title="Stock transfers"
          description="Move inventory between branches through a controlled draft → dispatch → receive workflow. Stock changes occur only when transfer actions are executed."
          actions={canAdjust ? <PrimaryButton type="button" onClick={() => { setError(""); setSuccess(""); setCreateOpen(true); }}>+ New transfer</PrimaryButton> : undefined}
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Transfer summary">
          <MetricCard label="Matching transfers" value={items.length} icon="↔" meta={status ? transferStatusLabel(status) : "All statuses"} />
          <MetricCard label="Active workflow" value={activeTransfers} icon="↻" tone="info" meta="Draft or in transit" />
          <MetricCard label="Received" value={receivedTransfers} icon="✓" tone="success" meta="Completed transfers" />
          <MetricCard label="Visible lines" value={lineCount} icon="▦" tone="coral" meta="Across current results" />
        </section>

        {success ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[#1f8a5b]">{success}</div> : null}
        {error ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p></Panel> : null}

        <Panel className="p-5">
          <SectionHeader title="Transfer filters" description="Filter by workflow status without changing transfer state." />
          <label className="mt-4 block max-w-xs text-[11px] font-semibold text-[#655b53]">
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="field mt-1.5">
              {STATUSES.map((value) => <option key={value} value={value}>{value ? transferStatusLabel(value) : "All statuses"}</option>)}
            </select>
          </label>
        </Panel>

        <DataTableFrame>
          <div className="px-5 py-4"><SectionHeader title="Transfers" description="Open a transfer to review its ledger trail and perform the next valid workflow action." /></div>
          {listQuery.isLoading ? <p className="px-5 pb-6 text-sm text-[#73685f]">Loading transfers…</p> : null}
          {items.length === 0 && !listQuery.isLoading ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No transfers match this filter.</p> : null}
          {items.length > 0 ? (
            <table className="premium-table min-w-[760px] text-left text-[12px]">
              <thead><tr><th className="px-5 pb-3">Route</th><th className="px-5 pb-3 text-right">Lines</th><th className="px-5 pb-3 text-right">Status</th><th className="px-5 pb-3 text-right">Open</th></tr></thead>
              <tbody>
                {items.map((transfer) => (
                  <tr key={transfer.id}>
                    <td className="px-5 py-3 font-semibold text-[#2a241f]">{branchName(transfer.fromBranchId)} <span className="mx-2 text-[#9a8d83]">→</span> {branchName(transfer.toBranchId)}</td>
                    <td className="font-data px-5 py-3 text-right text-[#73685f]">{transfer.lines.length}</td>
                    <td className="px-5 py-3 text-right"><StatusPill tone={statusTone(transfer.status)}>{transferStatusLabel(transfer.status)}</StatusPill></td>
                    <td className="px-5 py-3 text-right"><Link href={`/transfers/${transfer.id}`} className="text-[11px] font-semibold text-[#e44e34]">Review →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </DataTableFrame>
        {!canAdjust ? <Panel className="bg-[#fff4df] p-4 text-[11px] font-medium text-[#8a5606]">Your role can review transfers but cannot create or progress inventory transfer workflows.</Panel> : null}
      </main>

      <Modal
        open={createOpen && canAdjust}
        onClose={() => !busy && setCreateOpen(false)}
        title="Create stock transfer"
        description="Create a draft first. Stock does not leave the source branch until the transfer is explicitly dispatched."
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="transfer-create-form" disabled={busy}>{busy ? "Creating…" : "Create draft"}</PrimaryButton></div>}
      >
        <form id="transfer-create-form" noValidate onSubmit={(event) => void createTransfer(event)} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-[#655b53]">From branch<select value={fromBranchId} onChange={(event) => setFromBranchId(event.target.value)} required className="field mt-1.5"><option value="">Select source</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label className="text-[11px] font-semibold text-[#655b53]">To branch<select value={toBranchId} onChange={(event) => setToBranchId(event.target.value)} required className="field mt-1.5"><option value="">Select destination</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          </div>
          <section className="border-t border-[#eadfd6] pt-5">
            <SectionHeader title="Transfer lines" description="Choose active products from the catalog instead of entering internal product IDs." />
            <div className="mt-4 space-y-3">
              {lines.map((line, index) => (
                <div key={index} className="grid gap-3 rounded-xl border border-[#eee4db] bg-white p-3 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
                  <label className="text-[11px] font-semibold text-[#655b53]">Product<select value={line.productId} onChange={(event) => setLines(lines.map((item, lineIndex) => lineIndex === index ? { ...item, productId: event.target.value } : item))} className="field mt-1.5"><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ""}</option>)}</select></label>
                  <label className="text-[11px] font-semibold text-[#655b53]">Qty<input type="number" min={1} step={1} value={line.qty} onChange={(event) => setLines(lines.map((item, lineIndex) => lineIndex === index ? { ...item, qty: Number(event.target.value) } : item))} className="field mt-1.5" /></label>
                  <GhostButton type="button" className="self-end" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))}>Remove</GhostButton>
                </div>
              ))}
            </div>
            <GhostButton type="button" className="mt-3" onClick={() => setLines([...lines, { productId: "", qty: 1 }])}>+ Add line</GhostButton>
          </section>
          {productsQuery.isError ? <p className="text-[11px] text-[#b56d0c]">Products could not be loaded. Close and retry the transfer modal.</p> : null}
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>
    </AppShell>
  );
}
