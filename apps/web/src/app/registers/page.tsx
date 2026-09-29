"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Modal } from "../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import { errorText } from "../../lib/billing";
import { canManageRegisters } from "../../lib/shifts";

interface Me {
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

interface RegisterRow {
  id: string;
  name: string;
  isActive: boolean;
  branchId: string | null;
  branchName: string | null;
}

interface BranchRow {
  id: string;
  name: string;
}

export default function RegistersPage(): JSX.Element {
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<RegisterRow | null>(null);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: BranchRow[] }>("/api/v1/branches"),
    retry: false,
  });
  const listQuery = useQuery({
    queryKey: ["registers"],
    queryFn: () => apiFetch<{ items: RegisterRow[] }>("/api/v1/registers"),
    retry: false,
  });

  const manageable = canManageRegisters(meQuery.data?.role ?? "cashier");
  const items = listQuery.data?.items ?? [];
  const activeCount = items.filter((register) => register.isActive).length;
  const assignedCount = items.filter((register) => register.branchId !== null).length;

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

  async function createRegister(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) {
      setError("VALIDATION: Register name is required.");
      return;
    }
    try {
      await mutate("/api/v1/registers", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), branchId: branchId || undefined }),
      });
      setName("");
      setBranchId("");
      setCreateOpen(false);
      setSuccess("Register created.");
    } catch {
      // mutate already surfaced the error.
    }
  }

  async function archiveRegister(): Promise<void> {
    if (!archiveTarget) return;
    try {
      await mutate(`/api/v1/registers/${archiveTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      });
      setSuccess(`${archiveTarget.name} was archived.`);
      setArchiveTarget(null);
    } catch {
      // mutate already surfaced the error.
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Operations / Counters"
          title="Registers"
          description="Manage physical checkout counters and their branch assignment without affecting historical shifts or receipts."
          actions={manageable ? <PrimaryButton type="button" onClick={() => { setError(""); setSuccess(""); setCreateOpen(true); }}>+ Create register</PrimaryButton> : undefined}
        />

        <section className="grid gap-4 sm:grid-cols-3" aria-label="Register summary">
          <MetricCard label="Registers" value={items.length} icon="▣" meta="All counters" />
          <MetricCard label="Active" value={activeCount} icon="✓" tone="success" meta="Available for shifts" />
          <MetricCard label="Assigned to branch" value={assignedCount} icon="⌘" tone="info" meta="Explicit branch scope" />
        </section>

        {success ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[#1f8a5b]">{success}</div> : null}
        {error ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p></Panel> : null}

        <DataTableFrame>
          <div className="px-5 py-4">
            <SectionHeader title="Checkout registers" description="Archive unused counters instead of deleting them so shift history remains traceable." />
          </div>
          {listQuery.isLoading ? <p className="px-5 pb-6 text-sm text-[#73685f]">Loading registers…</p> : null}
          {listQuery.isError ? <p role="alert" className="px-5 pb-6 text-sm font-medium text-[#c43e3e]">Could not load registers.</p> : null}
          {listQuery.data && items.length === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No registers yet.</p> : null}
          {items.length > 0 ? (
            <table className="premium-table min-w-[680px] text-left text-[12px]">
              <thead>
                <tr>
                  <th className="px-5 pb-3">Register</th>
                  <th className="px-5 pb-3">Branch</th>
                  <th className="px-5 pb-3 text-right">Status</th>
                  <th className="px-5 pb-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((register) => (
                  <tr key={register.id}>
                    <td className="px-5 py-3 font-semibold text-[#2a241f]">{register.name}</td>
                    <td className="px-5 py-3 text-[#73685f]">{register.branchName ?? "No branch"}</td>
                    <td className="px-5 py-3 text-right"><StatusPill tone={register.isActive ? "ok" : "warn"}>{register.isActive ? "Active" : "Archived"}</StatusPill></td>
                    <td className="px-5 py-3 text-right">
                      {manageable && register.isActive ? <GhostButton type="button" onClick={() => setArchiveTarget(register)}>Archive</GhostButton> : <span className="text-[11px] text-[#9a8d83]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </DataTableFrame>

        {!manageable ? <Panel className="bg-[#fff4df] p-4 text-[11px] font-medium text-[#8a5606]">Only owners and managers can create or archive registers.</Panel> : null}
      </main>

      <Modal
        open={createOpen && manageable}
        onClose={() => !busy && setCreateOpen(false)}
        title="Create register"
        description="Add a checkout counter and optionally bind it to a branch. Opening cash belongs to a shift, not to register creation."
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton type="button" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</GhostButton>
            <PrimaryButton type="submit" form="create-register-form" disabled={busy || name.trim() === ""}>{busy ? "Creating…" : "Create register"}</PrimaryButton>
          </div>
        }
      >
        <form id="create-register-form" noValidate onSubmit={(event) => void createRegister(event)} className="space-y-4">
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Register name
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} required placeholder="Counter 1" className="field mt-1.5" />
          </label>
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Branch
            <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="field mt-1.5">
              <option value="">No branch</option>
              {(branchesQuery.data?.items ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={archiveTarget !== null}
        onCancel={() => !busy && setArchiveTarget(null)}
        onConfirm={() => void archiveRegister()}
        busy={busy}
        title="Archive register?"
        description="The counter will no longer be available for new shifts, but its existing shift and receipt history remains intact."
        confirmLabel="Archive register"
        details={archiveTarget ? <strong className="text-[#2a241f]">{archiveTarget.name}</strong> : null}
      />
    </AppShell>
  );
}
