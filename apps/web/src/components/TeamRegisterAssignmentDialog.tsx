"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "./Modal";
import { GhostButton, PrimaryButton } from "./ui";
import { apiFetch } from "../lib/api";
import { errorText } from "../lib/billing";
import {
  loadTeamBranchAssignment, loadTeamRegisterAssignment, saveTeamRegisterAssignment,
} from "../lib/team-api";
import type { TeamMemberRow } from "../lib/team-view";

interface Register { id: string; name: string; branchId: string | null; isActive: boolean }

export function TeamRegisterAssignmentDialog({
  member, onClose, onSaved,
}: {
  member: TeamMemberRow | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}): React.JSX.Element {
  const [all, setAll] = useState(true);
  const [ids, setIds] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const branchScope = useQuery({
    queryKey: ["owner-team-branch-assignment", member?.id],
    queryFn: () => loadTeamBranchAssignment(member!.id),
    enabled: member !== null,
    retry: false,
  });
  const registers = useQuery({
    queryKey: ["owner-team-registers"],
    queryFn: () => apiFetch<{ items: Register[] }>("/api/v1/registers"),
    enabled: member !== null,
    retry: false,
  });
  const assignment = useQuery({
    queryKey: ["owner-team-register-assignment", member?.id],
    queryFn: () => loadTeamRegisterAssignment(member!.id),
    enabled: member !== null,
    retry: false,
  });
  useEffect(() => {
    if (!assignment.data) return;
    setAll(assignment.data.registerIds === null);
    setIds(assignment.data.registerIds ?? []);
  }, [assignment.data]);
  const permittedBranches = branchScope.data?.branchIds;
  const eligible = registers.data?.items.filter((item) =>
    item.isActive && item.branchId && permittedBranches?.includes(item.branchId),
  ) ?? [];
  const loading = branchScope.isLoading || assignment.isLoading || registers.isLoading;
  const failed = branchScope.isError || assignment.isError || registers.isError;

  function close(): void {
    if (busy) return;
    setPassword(""); setError(""); onClose();
  }
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!member || busy || loading || failed || permittedBranches === null || permittedBranches === undefined) return;
    setBusy(true);
    setError("");
    try {
      await saveTeamRegisterAssignment(member.id, all ? null : ids, password);
      await queryClient.invalidateQueries({ queryKey: ["owner-team-register-assignment", member.id] });
      onSaved(member.name);
      onClose();
    } catch (cause) {
      setError(errorText(cause, "Could not update register access."));
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <Modal
      open={member !== null} onClose={close} title="Assign staff registers"
      description={member ? `Limit register access for ${member.name}, within their assigned branches.` : undefined}
      footer={<div className="flex justify-end gap-2">
        <GhostButton type="button" disabled={busy} onClick={close}>Cancel</GhostButton>
        <PrimaryButton type="submit" form="team-register-assignment"
          disabled={busy || loading || failed || permittedBranches === null || permittedBranches === undefined}>
          {busy ? "Saving…" : "Verify & save registers"}
        </PrimaryButton>
      </div>}
    >
      <form id="team-register-assignment" onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="rounded-xl bg-[#fcf1df] p-3 text-xs leading-5 text-[#836027]">
          Assign branches first. Register limits restrict POS, sales and shifts, including direct API requests.
          Business-wide financial reports remain unavailable while a register allowlist is active.
        </p>
        {loading ? <p role="status" className="text-sm text-[var(--color-atlas-muted-strong)]">Loading register access…</p> : null}
        {failed ? <p role="alert" className="text-sm text-[#b74945]">Register access could not load.</p> : null}
        {!loading && permittedBranches === null ? (
          <p role="alert" className="text-sm text-[#b74945]">This employee needs a branch assignment before registers can be restricted.</p>
        ) : null}
        <label className="flex min-h-11 items-center gap-3 rounded-xl bg-[#f7f8f5] p-3 text-sm">
          <input type="checkbox" checked={all} disabled={busy || loading}
            onChange={(event) => setAll(event.target.checked)} />
          All registers within permitted branches
        </label>
        {!all ? <fieldset className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-[#e5e9e3] p-3">
          <legend className="px-2 text-xs font-semibold">Allowed registers</legend>
          {eligible.map((register) => (
            <label key={register.id} className="flex min-h-11 items-center gap-3 rounded-lg bg-[#f7f8f5] px-3 py-2 text-sm">
              <input type="checkbox" checked={ids.includes(register.id)} disabled={busy}
                onChange={(event) => setIds((before) => event.target.checked
                  ? [...before.filter((id) => id !== register.id), register.id]
                  : before.filter((id) => id !== register.id))} />
              {register.name}
            </label>
          ))}
          {eligible.length === 0 ? <p className="text-xs text-[var(--color-atlas-muted-strong)]">No active registers in assigned branches.</p> : null}
        </fieldset> : null}
        <label className="block text-xs font-semibold text-[#655b53]">
          Confirm owner password
          <input type="password" autoComplete="current-password" className="field mt-1.5" required
            value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p role="alert" className="text-xs text-[#b74945]">{error}</p> : null}
      </form>
    </Modal>
  );
}
