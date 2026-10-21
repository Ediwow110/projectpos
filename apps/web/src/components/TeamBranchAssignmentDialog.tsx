"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "./Modal";
import { GhostButton, PrimaryButton } from "./ui";
import { apiFetch } from "../lib/api";
import { errorText } from "../lib/billing";
import { loadTeamBranchAssignment, saveTeamBranchAssignment } from "../lib/team-api";
import type { TeamMemberRow } from "../lib/team-view";

interface Branch { id: string; name: string; isActive: boolean }

export function TeamBranchAssignmentDialog({
  member, onClose, onSaved,
}: {
  member: TeamMemberRow | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}): React.JSX.Element {
  const [unrestricted, setUnrestricted] = useState(true);
  const [ids, setIds] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const branchList = useQuery({
    queryKey: ["owner-team-branches"],
    queryFn: () => apiFetch<{ items: Branch[] }>("/api/v1/branches"),
    enabled: member !== null,
    retry: false,
  });
  const assignment = useQuery({
    queryKey: ["owner-team-branch-assignment", member?.id],
    queryFn: () => loadTeamBranchAssignment(member!.id),
    enabled: member !== null,
    retry: false,
  });

  useEffect(() => {
    if (!assignment.data) return;
    setUnrestricted(assignment.data.branchIds === null);
    setIds(assignment.data.branchIds ?? []);
  }, [assignment.data]);

  const loading = assignment.isLoading || branchList.isLoading;
  function close(): void {
    if (busy) return;
    setPassword("");
    setError("");
    onClose();
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!member || busy || loading) return;
    if (!unrestricted && ids.length === 0) {
      setError("Choose at least one active branch, or select unrestricted access.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveTeamBranchAssignment(member.id, unrestricted ? null : ids, password);
      await queryClient.invalidateQueries({ queryKey: ["owner-team-branch-assignment", member.id] });
      await queryClient.invalidateQueries({ queryKey: ["owner-team-register-assignment", member.id] });
      setPassword("");
      onSaved(member.name);
      onClose();
    } catch (cause) {
      setError(errorText(cause, "Unable to save the branch assignment."));
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <Modal
      open={member !== null}
      onClose={close}
      title="Assign staff branch access"
      description={member ? `Configure branch access for ${member.name}. Changes affect the employee's existing sessions immediately.` : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <GhostButton type="button" disabled={busy} onClick={close}>Cancel</GhostButton>
          <PrimaryButton type="submit" form="staff-branch-assignment" disabled={busy || loading || assignment.isError || branchList.isError}>
            {busy ? "Saving…" : "Verify & save branches"}
          </PrimaryButton>
        </div>
      }
    >
      <form id="staff-branch-assignment" onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="rounded-xl bg-[#fcf1df] p-3 text-xs leading-5 text-[#836027]">
          Restricted staff can use only branch-audited API routes. Sales and stock actions are limited to their
          active assigned branch; business-wide reports and other unsupported operations are blocked.
          This is a security restriction, not a full multi-branch workflow.
          Returning to unrestricted branch access also removes any register-specific restrictions.
        </p>
        {loading ? <p role="status" className="text-sm text-[var(--color-atlas-muted-strong)]">Loading branches…</p> : null}
        {assignment.isError || branchList.isError ? (
          <p role="alert" className="text-sm text-[#b74945]">Unable to load branch assignments. Saving is disabled.</p>
        ) : null}
        <label className="flex min-h-11 items-center gap-3 rounded-xl bg-[#f7f8f5] p-3 text-sm font-semibold text-[#202826]">
          <input type="checkbox" checked={unrestricted} disabled={busy || loading}
            onChange={(event) => setUnrestricted(event.target.checked)} />
          Unrestricted — access all business branches (legacy behavior)
        </label>
        {!unrestricted ? (
          <fieldset className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-[#e5e9e3] p-3">
            <legend className="px-2 text-xs font-semibold text-[#655b53]">Permitted active branches</legend>
            {(branchList.data?.items ?? []).filter((branch) => branch.isActive).map((branch) => (
              <label key={branch.id} className="flex min-h-11 items-center gap-3 rounded-lg bg-[#f7f8f5] px-3 py-2 text-sm">
                <input type="checkbox" checked={ids.includes(branch.id)} disabled={busy}
                  onChange={(event) => setIds((previous) => event.target.checked
                    ? [...previous, branch.id] : previous.filter((id) => id !== branch.id))} />
                {branch.name}
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="block text-xs font-semibold text-[#655b53]">
          Confirm owner password
          <input className="field mt-1.5" type="password" autoComplete="current-password"
            required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p role="alert" className="text-xs text-[#b74945]">{error}</p> : null}
      </form>
    </Modal>
  );
}
