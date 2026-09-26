"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Modal } from "../../components/Modal";
import { MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import { errorText } from "../../lib/billing";
import { canManageBranches, transferStatusLabel } from "../../lib/branches";

interface Me {
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

export interface BranchRow {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

interface TransferRow {
  id: string;
  fromBranchId: string;
  toBranchId: string;
  status: string;
  lines: Array<{ productId: string; qty: number }>;
}

export default function BranchesPage(): JSX.Element {
  const [name, setName] = useState("");
  const [type, setType] = useState("store");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<BranchRow | null>(null);
  const [busy, setBusy] = useState(false);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const listQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"),
    retry: false,
  });
  const transfersQuery = useQuery({
    queryKey: ["branch-transfers-overview"],
    queryFn: () => apiFetch<{ items: TransferRow[] }>("/api/v1/transfers"),
    retry: false,
  });

  const manageable = canManageBranches(meQuery.data?.role ?? "cashier");

  async function mutate(path: string, init: RequestInit): Promise<void> {
    setError("");
    setBusy(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(path, { csrfToken: csrf.csrfToken, init });
      await listQuery.refetch();
    } catch (err) {
      setError(errorText(err, "Update failed"));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function createBranch(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSuccess("");
    try {
      await mutate("/api/v1/branches", { method: "POST", body: JSON.stringify({ name: name.trim(), type }) });
      setName("");
      setType("store");
      setCreateOpen(false);
      setSuccess("Branch created.");
    } catch {
      // Error already surfaced by mutate.
    }
  }

  async function archiveBranch(): Promise<void> {
    if (!archiveTarget) return;
    setSuccess("");
    try {
      await mutate(`/api/v1/branches/${archiveTarget.id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
      setSuccess(`${archiveTarget.name} was archived.`);
      setArchiveTarget(null);
    } catch {
      // Error already surfaced by mutate.
    }
  }

  const branches = listQuery.data?.items ?? [];
  const active = branches.filter((branch) => branch.isActive);
  const stores = active.filter((branch) => branch.type === "store").length;
  const warehouses = active.filter((branch) => branch.type === "warehouse").length;
  const transfers = transfersQuery.data?.items ?? [];
  const pendingTransfers = transfers.filter((transfer) => transfer.status === "DRAFT" || transfer.status === "IN_TRANSIT").length;
  const branchName = (id: string): string => branches.find((branch) => branch.id === id)?.name ?? id.slice(0, 8);
  const transferTone = (status: string): "ok" | "warn" | "bad" | "info" =>
    status === "RECEIVED" ? "ok" : status === "CANCELLED" ? "bad" : status === "IN_TRANSIT" ? "info" : "warn";

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Business / Locations"
          title="Branches"
          description="Keep every location visible and operationally consistent without inventing health metrics that are not returned by the branch API."
          actions={<><Link href="/transfers" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Inventory transfers</Link>{manageable ? <PrimaryButton type="button" onClick={() => { setError(""); setSuccess(""); setCreateOpen(true); }}>+ Add branch</PrimaryButton> : null}</>}
        />

        {success ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[#1f8a5b]">{success}</div> : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Branch summary">
          <MetricCard label="Branches" value={branches.length} icon="⌘" meta="All returned locations" />
          <MetricCard label="Active" value={active.length} icon="✓" tone="success" meta="Currently available" />
          <MetricCard label="Stores" value={stores} icon="▣" tone="info" meta="Active store locations" />
          <MetricCard label="Pending transfers" value={pendingTransfers} icon="↔" tone={pendingTransfers > 0 ? "warning" : "success"} meta={warehouses + " active warehouse location(s)"} />
        </section>

        {listQuery.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading branches…</Panel> : null}
        {branches.length === 0 && !listQuery.isLoading ? (
          <Panel className="p-6"><SectionHeader title="No branches yet" description="Create the first location below." /></Panel>
        ) : null}

        {branches.length > 0 ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Branch cards">
            {branches.map((branch) => (
              <Panel key={branch.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <span aria-hidden className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff0ea] font-display text-lg text-[#f35d3f]">⌂</span>
                  <StatusPill tone={branch.isActive ? "ok" : "warn"}>{branch.isActive ? "Active" : "Archived"}</StatusPill>
                </div>
                <h2 className="font-display mt-4 text-lg font-semibold text-[#17130f]">{branch.name}</h2>
                <p className="mt-1 text-[11px] capitalize text-[#73685f]">{branch.type}</p>
                <div className="mt-5 flex items-center gap-2">
                  <Link href={"/reports/branches"} className="text-[11px] font-semibold text-[#e44e34]">View performance →</Link>
                  {manageable && branch.isActive ? (
                    <GhostButton
                      type="button"
                      className="ml-auto !min-h-8 !px-3 !py-1.5 text-xs"
                      onClick={() => setArchiveTarget(branch)}
                    >
                      Archive
                    </GhostButton>
                  ) : null}
                </div>
              </Panel>
            ))}
          </section>
        ) : null}

        <Panel className="p-5">
          <SectionHeader
            title="Inventory transfers"
            description="Recent stock movements between locations from the live transfers endpoint."
            action={<Link href="/transfers" className="text-[11px] font-semibold text-[#e44e34]">Manage transfers →</Link>}
          />
          {transfersQuery.isLoading ? <p className="mt-4 text-sm text-[#73685f]">Loading transfers…</p> : null}
          {transfersQuery.isError ? <p role="alert" className="mt-4 text-sm text-[#c43e3e]">Could not load transfers.</p> : null}
          {transfers.length === 0 && !transfersQuery.isLoading ? <p className="mt-4 text-sm text-[#8b8077]">No transfers yet.</p> : null}
          {transfers.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="premium-table min-w-[760px] text-left text-[12px]">
                <thead>
                  <tr>
                    <th className="pb-3">Transfer</th>
                    <th className="pb-3">From</th>
                    <th className="pb-3">To</th>
                    <th className="pb-3 text-right">Lines</th>
                    <th className="pb-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.slice(0, 6).map((transfer) => (
                    <tr key={transfer.id}>
                      <td className="py-3"><Link href={"/transfers/" + transfer.id} className="font-data font-medium text-[#2a241f] hover:text-[#d94a30]">{transfer.id.slice(0, 8)}</Link></td>
                      <td className="py-3 text-[#73685f]">{branchName(transfer.fromBranchId)}</td>
                      <td className="py-3 text-[#73685f]">{branchName(transfer.toBranchId)}</td>
                      <td className="font-data py-3 text-right">{transfer.lines.length}</td>
                      <td className="py-3 text-right"><StatusPill tone={transferTone(transfer.status)}>{transferStatusLabel(transfer.status)}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>

        {!manageable ? <Panel className="bg-[#fff4df] p-4 text-[11px] font-medium text-[#8a5606]">Your role can view branches but cannot create or archive them.</Panel> : null}
        {error !== "" ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2 text-sm font-medium text-[#c43e3e]">{error}</p> : null}
      </main>

      <Modal
        open={createOpen && manageable}
        onClose={() => !busy && setCreateOpen(false)}
        title="Add branch"
        description="Create a store or warehouse location. Inventory remains branch-scoped only when movements and registers explicitly reference it."
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="branch-create-form" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create branch"}</PrimaryButton></div>}
      >
        <form id="branch-create-form" onSubmit={(event) => void createBranch(event)} className="space-y-4">
          <label className="block text-[11px] font-semibold text-[#655b53]">Branch name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} required placeholder="North store" className="field mt-1.5" /></label>
          <label className="block text-[11px] font-semibold text-[#655b53]">Type<select value={type} onChange={(event) => setType(event.target.value)} className="field mt-1.5"><option value="store">Store</option><option value="warehouse">Warehouse</option></select></label>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={archiveTarget !== null}
        onCancel={() => !busy && setArchiveTarget(null)}
        onConfirm={() => void archiveBranch()}
        busy={busy}
        title="Archive branch?"
        description="The location will no longer be available for new operational assignments. Existing sales, inventory and transfer history remain intact."
        confirmLabel="Archive branch"
        details={archiveTarget ? <strong className="text-[#2a241f]">{archiveTarget.name}</strong> : null}
      />
    </AppShell>
  );
}
