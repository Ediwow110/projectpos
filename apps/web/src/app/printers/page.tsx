"use client";

import type { FormEvent, JSX } from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { Modal } from "../../components/Modal";
import { PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";

interface Me {
  role: string;
  businessName?: string;
}

interface Branch {
  id: string;
  name: string;
  isActive: boolean;
}

interface PrinterRow {
  id: string;
  branchId: string | null;
  name: string;
  width: string;
  connection: string;
  lastSeenAt: string | null;
  agentStatus: "online" | "offline" | "never";
  isDefault: boolean;
}

interface PrintJobRow {
  id: string;
  printerId: string;
  receiptNo: string | null;
  layout: string;
  status: string;
  attempts: number;
  createdAt: string;
}

interface EnrolledPrinter extends PrinterRow {
  agentToken: string;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? `${error.code}: ${error.message}` : fallback;
}

function agentLabel(status: PrinterRow["agentStatus"]): string {
  if (status === "online") return "Online";
  if (status === "offline") return "Offline";
  return "Never connected";
}

export default function PrintersPage(): JSX.Element {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const role = meQuery.data?.role ?? "cashier";
  const canManage = role === "owner" || role === "manager";
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: Branch[] }>("/api/v1/branches"),
    enabled: canManage,
    retry: false,
  });
  const printersQuery = useQuery({
    queryKey: ["printers"],
    queryFn: () => apiFetch<{ items: PrinterRow[] }>("/api/v1/printers"),
    enabled: canManage,
    retry: false,
    refetchInterval: 10_000,
  });
  const jobsQuery = useQuery({
    queryKey: ["print-jobs"],
    queryFn: () => apiFetch<{ items: PrintJobRow[] }>("/api/v1/print-jobs"),
    enabled: canManage,
    retry: false,
    refetchInterval: 5_000,
  });

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PrinterRow | null>(null);
  const [pairing, setPairing] = useState<EnrolledPrinter | null>(null);
  const [name, setName] = useState("");
  const [width, setWidth] = useState<"58" | "80">("80");
  const [branchId, setBranchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    if (!editTarget) return;
    setName(editTarget.name);
    setWidth(editTarget.width === "58" ? "58" : "80");
    setBranchId(editTarget.branchId ?? "");
    setError("");
  }, [editTarget]);

  async function csrf(): Promise<string> {
    return (await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf")).csrfToken;
  }

  async function refresh(): Promise<void> {
    await Promise.all([printersQuery.refetch(), jobsQuery.refetch()]);
  }

  async function enroll(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) { setError("Printer name is required."); return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      const token = await csrf();
      const enrolled = await apiFetch<EnrolledPrinter>("/api/v1/printers", {
        csrfToken: token,
        init: {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            width,
            connection: "manual",
            ...(branchId ? { branchId } : {}),
          }),
        },
      });
      setEnrollOpen(false);
      setPairing(enrolled);
      setName(""); setWidth("80"); setBranchId("");
      setSuccess(`${enrolled.name} enrolled. Save the pairing token now; it will not be shown again.`);
      await refresh();
    } catch (err) {
      setError(errorText(err, "Could not enroll printer."));
    } finally { setBusy(false); }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editTarget || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const token = await csrf();
      await apiFetch(`/api/v1/printers/${editTarget.id}/settings`, {
        csrfToken: token,
        init: { method: "POST", body: JSON.stringify({ name: name.trim(), width, branchId: branchId || null }) },
      });
      setEditTarget(null);
      setSuccess("Printer settings updated.");
      await refresh();
    } catch (err) { setError(errorText(err, "Could not update printer.")); }
    finally { setBusy(false); }
  }

  async function printerAction(path: string, message: string): Promise<void> {
    if (busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const token = await csrf();
      await apiFetch(path, { csrfToken: token, init: { method: "POST", body: "{}" } });
      setSuccess(message);
      await refresh();
    } catch (err) { setError(errorText(err, "Printer action failed.")); }
    finally { setBusy(false); }
  }

  const printers = printersQuery.data?.items ?? [];
  const branches = (branchesQuery.data?.items ?? []).filter((branch) => branch.isActive);
  const jobs = jobsQuery.data?.items ?? [];

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Administration / Printers"
          title="Receipt printers"
          description="Pair local printer agents, assign branches, choose the default receipt printer, and review jobs without pretending agent handoff proves paper output."
          actions={canManage ? <PrimaryButton type="button" onClick={() => { setError(""); setEnrollOpen(true); }}>+ Enroll printer</PrimaryButton> : undefined}
        />

        {!meQuery.isLoading && !canManage ? (
          <Panel className="border-[#f1d6ad] bg-[#fff8ea] p-5">
            <SectionHeader title="Printer administration requires manager access" description="Cashiers can queue receipts to configured printers from the receipt screen, but printer enrollment and queue administration stay protected." />
          </Panel>
        ) : null}

        {canManage ? (
          <>
            {(error || success) ? (
              <p role={error ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-[12px] font-medium ${error ? "bg-[#fff0f0] text-[#c43e3e]" : "bg-[#edf8f1] text-[#31744c]"}`}>{error || success}</p>
            ) : null}

            <Panel className="p-5">
              <SectionHeader title="Paired printers" description="Online means the paired agent checked in within the last two minutes. Offline printers can still receive queued jobs and will pick them up when the agent reconnects." />
              {printersQuery.isLoading ? <p className="mt-4 text-sm text-[#73685f]">Loading printers…</p> : printers.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-[#ddd0c6] bg-[#fcf8f3] p-6 text-center text-[12px] text-[#73685f]">No printers enrolled yet.</div>
              ) : (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {printers.map((printer) => {
                    const branch = printer.branchId ? branches.find((item) => item.id === printer.branchId)?.name ?? "Assigned branch" : "Unassigned / all branches";
                    return (
                      <article key={printer.id} className="rounded-2xl border border-[#eee4db] bg-white p-4 shadow-[0_8px_24px_-14px_rgb(28_20_15/0.18)]">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h2 className="font-display text-[15px] font-semibold text-[#2a241f]">{printer.name}</h2>
                            <p className="font-data mt-1 text-[9px] text-[#9a8d83]">{branch} · {printer.width}mm</p>
                          </div>
                          <div className="flex gap-2">
                            {printer.isDefault ? <StatusPill tone="info">Default</StatusPill> : null}
                            <StatusPill tone={printer.agentStatus === "online" ? "ok" : printer.agentStatus === "offline" ? "warn" : "info"}>{agentLabel(printer.agentStatus)}</StatusPill>
                          </div>
                        </div>
                        <p className="mt-3 text-[10px] text-[#73685f]">
                          {printer.lastSeenAt ? `Last agent check-in ${new Date(printer.lastSeenAt).toLocaleString()}.` : "The paired print agent has never checked in."}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <GhostButton type="button" disabled={busy} onClick={() => setEditTarget(printer)}>Settings</GhostButton>
                          {!printer.isDefault ? <GhostButton type="button" disabled={busy} onClick={() => void printerAction(`/api/v1/printers/${printer.id}/default`, `${printer.name} is now the default receipt printer.`)}>Make default</GhostButton> : null}
                          <GhostButton type="button" disabled={busy} onClick={() => void printerAction(`/api/v1/printers/${printer.id}/test`, `Test print queued for ${printer.name}.`)}>Test print</GhostButton>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel className="p-5">
              <SectionHeader title="Print queue" description="QUEUED waits for the agent. SENT means the agent claimed the job; NexPOS does not yet receive a physical-print acknowledgement." />
              {jobs.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-[#ddd0c6] p-5 text-center text-[11px] text-[#73685f]">No print jobs yet.</p> : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-[#eee4db]">
                  <table className="min-w-full text-left text-[11px]">
                    <thead className="bg-[#fcf8f3] text-[#73685f]"><tr><th className="px-4 py-3">Job</th><th className="px-4 py-3">Printer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Created</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
                    <tbody className="divide-y divide-[#eee4db] bg-white">
                      {jobs.slice(0, 40).map((job) => {
                        const printer = printers.find((item) => item.id === job.printerId);
                        return <tr key={job.id}>
                          <td className="px-4 py-3"><p className="font-semibold text-[#2a241f]">{job.receiptNo ? `Receipt ${job.receiptNo}` : "Test print"}</p><p className="font-data mt-1 text-[9px] text-[#9a8d83]">{job.id.slice(0, 12)}</p></td>
                          <td className="px-4 py-3 text-[#655b53]">{printer?.name ?? "Printer"}</td>
                          <td className="px-4 py-3"><StatusPill tone={job.status === "QUEUED" ? "info" : "ok"}>{job.status}</StatusPill><p className="font-data mt-1 text-[9px] text-[#9a8d83]">attempts {job.attempts}</p></td>
                          <td className="px-4 py-3 font-data text-[9px] text-[#73685f]">{new Date(job.createdAt).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{job.status !== "QUEUED" ? <GhostButton type="button" disabled={busy} onClick={() => void printerAction(`/api/v1/print-jobs/${job.id}/retry`, "Print job requeued as a new job.")}>Requeue</GhostButton> : <span className="text-[10px] text-[#9a8d83]">Waiting</span>}</td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        ) : null}
      </main>

      <Modal
        open={enrollOpen}
        title="Enroll receipt printer"
        description="Create a pairing token for a local NexPOS print agent. The token is displayed once and only its hash is stored."
        onClose={() => { if (!busy) setEnrollOpen(false); }}
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" disabled={busy} onClick={() => setEnrollOpen(false)}>Cancel</GhostButton><PrimaryButton type="submit" form="printer-enroll-form" disabled={busy}>{busy ? "Enrolling…" : "Enroll printer"}</PrimaryButton></div>}
      >
        <form id="printer-enroll-form" noValidate onSubmit={(event) => void enroll(event)} className="space-y-4">
          <label className="block text-[11px] font-semibold text-[#655b53]">Printer name<input autoFocus className="field mt-1.5" value={name} onChange={(event) => setName(event.target.value)} placeholder="Front Till" /></label>
          <label className="block text-[11px] font-semibold text-[#655b53]">Branch<select className="field mt-1.5" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Unassigned / all branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label className="block text-[11px] font-semibold text-[#655b53]">Paper width<select className="field mt-1.5" value={width} onChange={(event) => setWidth(event.target.value as "58" | "80")}><option value="80">80mm</option><option value="58">58mm</option></select></label>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

      <Modal
        open={editTarget !== null}
        title="Printer settings"
        description={editTarget ? `Update ${editTarget.name}. Pairing credentials are unchanged.` : undefined}
        onClose={() => { if (!busy) setEditTarget(null); }}
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" disabled={busy} onClick={() => setEditTarget(null)}>Cancel</GhostButton><PrimaryButton type="submit" form="printer-settings-form" disabled={busy}>{busy ? "Saving…" : "Save settings"}</PrimaryButton></div>}
      >
        <form id="printer-settings-form" noValidate onSubmit={(event) => void saveSettings(event)} className="space-y-4">
          <label className="block text-[11px] font-semibold text-[#655b53]">Printer name<input className="field mt-1.5" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="block text-[11px] font-semibold text-[#655b53]">Branch<select className="field mt-1.5" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Unassigned / all branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label className="block text-[11px] font-semibold text-[#655b53]">Paper width<select className="field mt-1.5" value={width} onChange={(event) => setWidth(event.target.value as "58" | "80")}><option value="80">80mm</option><option value="58">58mm</option></select></label>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

      <Modal
        open={pairing !== null}
        title="Printer pairing token"
        description="Copy this token into the local printer agent now. NexPOS will never show this exact token again."
        onClose={() => { setPairing(null); setCopyStatus(""); }}
        footer={<PrimaryButton type="button" onClick={() => { setPairing(null); setCopyStatus(""); }}>Close pairing token</PrimaryButton>}
      >
        {pairing ? <div className="space-y-4">
          <div className="rounded-xl border border-[#f0e2d7] bg-[#fff8f3] p-4"><p className="text-[11px] font-semibold text-[#655b53]">{pairing.name}</p><code data-ui="printer-agent-token" className="mt-2 block break-all rounded-lg bg-white p-3 font-data text-[11px] text-[#2a241f]">{pairing.agentToken}</code></div>
          <GhostButton type="button" onClick={() => void navigator.clipboard.writeText(pairing.agentToken).then(() => setCopyStatus("Pairing token copied."))}>Copy pairing token</GhostButton>
          {copyStatus ? <p role="status" className="text-[11px] font-medium text-[#31744c]">{copyStatus}</p> : null}
        </div> : null}
      </Modal>
    </AppShell>
  );
}
