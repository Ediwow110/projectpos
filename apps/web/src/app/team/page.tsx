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
import { createTeamMemberRequest, deactivateTeamMemberRequest, saveTeamApprovalPinRequest } from "../../lib/team-api";
import { canDeactivateMember, canManageApprovalPin, isActiveAssignment, teamRoleLabel, type TeamMemberRow, type TeamRoleAssignment } from "../../lib/team-view";
import { useTeamPageState } from "./use-team-page-state";

interface Me {
  userId: string;
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

const ROLES = [
  { value: "manager", label: "Manager" },
  { value: "cashier", label: "Cashier" },
  { value: "inventory", label: "Inventory" },
] as const;

export default function TeamPage(): JSX.Element {
  const {
    createOpen, setCreateOpen, name, setName, email, setEmail, role, setRole,
    busy, setBusy, error, setError, success, setSuccess,
    temporaryCredential, setTemporaryCredential, copyStatus, setCopyStatus,
    deactivateTarget, setDeactivateTarget, pinTarget, setPinTarget,
    approvalPin, setApprovalPin, approvalPinConfirm, setApprovalPinConfirm,
  } = useTeamPageState();
  const [roleTarget, setRoleTarget] = useState<TeamMemberRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<TeamRoleAssignment | null>(null);
  const [delegationRole, setDelegationRole] = useState("manager");
  const [delegationType, setDelegationType] = useState<"PERMANENT" | "TEMPORARY">("TEMPORARY");
  const [delegationExpiresAt, setDelegationExpiresAt] = useState("");
  const [delegationReason, setDelegationReason] = useState("");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });
  const isOwner = meQuery.data?.role === "owner";
  const membersQuery = useQuery({
    queryKey: ["memberships"],
    queryFn: () => apiFetch<{ items: TeamMemberRow[] }>("/api/v1/memberships"),
    retry: false,
    enabled: isOwner,
  });

  const members = membersQuery.data?.items ?? [];
  const activeMembers = members.filter((member) => member.deactivatedAt === null);
  const staffCount = activeMembers.filter((member) => member.role !== "owner").length;

  function resetCreate(): void {
    setName("");
    setEmail("");
    setRole("cashier");
    setError("");
  }

  async function createMember(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName) {
      setError("Name is required.");
      return;
    }
    if (!cleanEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    setTemporaryCredential(null);
    setCopyStatus("");
    try {
      const created = await createTeamMemberRequest({ name: cleanName, email: cleanEmail, role });
      await membersQuery.refetch();
      setTemporaryCredential(
        created.tempPassword
          ? { name: cleanName, email: cleanEmail, password: created.tempPassword }
          : null,
      );
      setSuccess(
        created.tempPassword
          ? "Team member created. Share the temporary password securely and have them sign in."
          : "Existing user added to this business.",
      );
      setCreateOpen(false);
      resetCreate();
    } catch (err) {
      setError(errorText(err, "Could not create team member."));
    } finally {
      setBusy(false);
    }
  }

  async function copyTemporaryPassword(): Promise<void> {
    if (!temporaryCredential) return;
    try {
      await navigator.clipboard.writeText(temporaryCredential.password);
      setCopyStatus("Temporary password copied.");
    } catch {
      setCopyStatus("Copy failed. Select the password and copy it manually.");
    }
  }

  function closeTemporaryCredential(): void {
    setTemporaryCredential(null);
    setCopyStatus("");
  }

  async function deactivateMember(): Promise<void> {
    if (!deactivateTarget || busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await deactivateTeamMemberRequest(deactivateTarget.id);
      setSuccess(deactivateTarget.name + " was deactivated.");
      setDeactivateTarget(null);
      await membersQuery.refetch();
    } catch (err) {
      setError(errorText(err, "Could not deactivate team member."));
    } finally {
      setBusy(false);
    }
  }

  async function reactivateMember(member: TeamMemberRow): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/memberships/${member.id}/reactivate`, { csrfToken: csrf.csrfToken, init: { method: "POST" } });
      setSuccess(`${member.name} was reactivated. Previous temporary roles were not restored.`);
      await membersQuery.refetch();
    } catch (err) {
      setError(errorText(err, "Could not reactivate team member."));
    } finally {
      setBusy(false);
    }
  }

  async function assignRole(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!roleTarget || busy) return;
    if (delegationType === "TEMPORARY" && !delegationReason.trim()) {
      setError("A reason is required for temporary delegation.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/memberships/${roleTarget.id}/role-assignments`, {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            role: delegationRole,
            assignmentType: delegationType,
            expiresAt: delegationType === "TEMPORARY" && delegationExpiresAt ? new Date(delegationExpiresAt).toISOString() : null,
            reason: delegationReason.trim() || null,
            idempotencyKey: `team-${roleTarget.id}-${delegationRole}-${delegationType}-${delegationExpiresAt || "manual"}`,
          }),
        },
      });
      setSuccess(`${teamRoleLabel(delegationRole)} was assigned to ${roleTarget.name}.`);
      setRoleTarget(null);
      await membersQuery.refetch();
    } catch (err) {
      setError(errorText(err, "Could not assign role."));
    } finally {
      setBusy(false);
    }
  }

  async function revokeRole(): Promise<void> {
    if (!revokeTarget || busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/role-assignments/${revokeTarget.id}/revoke`, {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ reason: "Role coverage ended" }) },
      });
      setSuccess(`${teamRoleLabel(revokeTarget.role)} assignment was revoked.`);
      setRevokeTarget(null);
      setRoleTarget(null);
      await membersQuery.refetch();
    } catch (err) {
      setError(errorText(err, "Could not revoke role."));
    } finally {
      setBusy(false);
    }
  }

  async function saveApprovalPin(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!pinTarget || busy) return;
    if (!/^\d{6}$/.test(approvalPin)) {
      setError("Approval PIN must be exactly six digits.");
      return;
    }
    if (approvalPin !== approvalPinConfirm) {
      setError("Approval PIN confirmation does not match.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await saveTeamApprovalPinRequest(pinTarget.id, approvalPin);
      setSuccess(`${pinTarget.name}'s approval PIN was ${pinTarget.approvalPinSet ? "rotated" : "enrolled"}.`);
      setPinTarget(null);
      setApprovalPin("");
      setApprovalPinConfirm("");
      await membersQuery.refetch();
    } catch (err) {
      setError(errorText(err, "Could not update approval PIN."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Administration / Team"
          title="Team"
          description="Manage who can sign in to this business and which operational role they receive."
          actions={
            isOwner ? (
              <PrimaryButton type="button" onClick={() => { resetCreate(); setCreateOpen(true); }}>
                + Add team member
              </PrimaryButton>
            ) : undefined
          }
        />

        {!meQuery.isLoading && !isOwner ? (
          <Panel className="border-[#f1d6ad] bg-[#fff8ea] p-5">
            <SectionHeader
              title="Owner access required"
              description="Team membership changes require the user.manage permission. Ask the business owner to manage staff access."
            />
          </Panel>
        ) : null}

        {isOwner ? (
          <>
            <section className="grid gap-4 sm:grid-cols-3" aria-label="Team summary">
              <MetricCard label="Active users" value={activeMembers.length} icon="◎" meta="Current memberships" />
              <MetricCard label="Staff" value={staffCount} icon="○" tone="info" meta="Non-owner users" />
              <MetricCard label="Owner seats" value={activeMembers.filter((member) => member.role === "owner").length} icon="◆" tone="success" meta="Protected role" />
            </section>

            {success ? <p role="status" className="rounded-xl border border-[#b9dfca] bg-[#f0faf5] px-4 py-3 text-sm font-medium text-[#1f6f4b]">{success}</p> : null}
            {error ? <p role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-4 py-3 text-sm font-medium text-[#c43e3e]">{error}</p> : null}

            <DataTableFrame>
              <div className="px-5 py-4">
                <SectionHeader
                  title="Active team members"
                  description="Roles control permissions on the server; hiding a UI action is never the security boundary."
                />
              </div>
              {membersQuery.isLoading ? <p className="px-5 pb-6 text-sm text-[#73685f]">Loading team…</p> : null}
              {members.length === 0 && !membersQuery.isLoading ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No active team members.</p> : null}
              {members.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="premium-table min-w-[760px] text-left text-[12px]">
                    <thead>
                      <tr>
                        <th className="px-5 pb-3">Name</th>
                        <th className="px-5 pb-3">Email</th>
                        <th className="px-5 pb-3">Role</th>
                        <th className="px-5 pb-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.id} className={member.deactivatedAt ? "opacity-65" : undefined}>
                          <td className="px-5 py-3 font-semibold text-[#2a241f]">{member.name}</td>
                          <td className="px-5 py-3 text-[#655b53]">{member.email}</td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {(member.assignments === undefined || member.assignments.length === 0 ? [{ id: `${member.id}-legacy-role`, role: member.role, assignmentType: "PERMANENT" as const, branchId: null, startsAt: new Date().toISOString(), expiresAt: null, assignedBy: "", assignedAt: new Date().toISOString(), assignmentReason: null, revokedAt: null, revokedBy: null, revocationReason: null }] : member.assignments.filter((assignment) => isActiveAssignment(assignment))).map((assignment) => (
                                <StatusPill key={assignment.id} tone={assignment.role === "owner" ? "ok" : "info"}>
                                  {teamRoleLabel(assignment.role)}{assignment.assignmentType === "TEMPORARY" ? " · Temporary" : ""}
                                </StatusPill>
                              ))}
                              {member.deactivatedAt ? <StatusPill tone="warn">Deactivated</StatusPill> : null}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              {canManageApprovalPin(member) ? (
                                <GhostButton
                                  type="button"
                                  className="!min-h-8 !px-3 !py-1.5 text-xs"
                                  onClick={() => {
                                    setError("");
                                    setPinTarget(member);
                                    setApprovalPin("");
                                    setApprovalPinConfirm("");
                                  }}
                                >
                                  {member.approvalPinSet ? "Rotate approval PIN" : "Set approval PIN"}
                                </GhostButton>
                              ) : null}
                              {member.deactivatedAt === null && member.role !== "owner" ? (
                                <GhostButton type="button" className="!min-h-8 !px-3 !py-1.5 text-xs" onClick={() => {
                                  setRoleTarget(member);
                                  setDelegationRole("manager");
                                  setDelegationType("TEMPORARY");
                                  setDelegationExpiresAt("");
                                  setDelegationReason("");
                                  setError("");
                                }}>
                                  Manage roles
                                </GhostButton>
                              ) : null}
                              {member.deactivatedAt !== null ? (
                                <GhostButton type="button" className="!min-h-8 !px-3 !py-1.5 text-xs" onClick={() => void reactivateMember(member)} disabled={busy}>
                                  Reactivate
                                </GhostButton>
                              ) : null}
                              {canDeactivateMember(meQuery.data?.userId ?? "", member) ? (
                                <GhostButton type="button" className="!min-h-8 !px-3 !py-1.5 text-xs" onClick={() => setDeactivateTarget(member)}>
                                  Deactivate
                                </GhostButton>
                              ) : !canManageApprovalPin(member) ? (
                                <span className="self-center text-[10px] font-medium text-[#9a8d83]">
                                  {member.userId === meQuery.data?.userId ? "Current user" : "Protected"}
                                </span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </DataTableFrame>
          </>
        ) : null}
      </main>

      <Modal
        open={createOpen}
        onClose={() => { if (!busy) setCreateOpen(false); }}
        title="Add team member"
        description="Create a staff login and assign the operational role they need."
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton type="button" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</GhostButton>
            <PrimaryButton type="submit" form="team-create-form" disabled={busy} aria-busy={busy}>
              {busy ? "Creating…" : "Create team member"}
            </PrimaryButton>
          </div>
        }
      >
        <form id="team-create-form" noValidate onSubmit={(event) => void createMember(event)} className="space-y-4">
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Name
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="field mt-1.5" autoComplete="name" />
          </label>
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} className="field mt-1.5" inputMode="email" autoComplete="email" />
          </label>
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Role
            <select value={role} onChange={(event) => setRole(event.target.value)} className="field mt-1.5">
              {ROLES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

      <Modal
        open={roleTarget !== null}
        onClose={() => { if (!busy) setRoleTarget(null); }}
        title="Manage roles"
        description={roleTarget ? `${roleTarget.name} keeps their own account and audit identity. Add or revoke role assignments here.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton type="button" onClick={() => setRoleTarget(null)} disabled={busy}>Close</GhostButton>
            <PrimaryButton type="submit" form="role-assignment-form" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Assign role"}</PrimaryButton>
          </div>
        }
      >
        {roleTarget ? (
          <div className="space-y-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8b8077]">Active assignments</p>
              <div className="mt-2 space-y-2">
                {(roleTarget.assignments ?? []).filter((assignment) => isActiveAssignment(assignment)).map((assignment) => (
                  <div key={assignment.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#f0e2d7] bg-[#fffaf6] px-3 py-2 text-[11px]">
                    <div>
                      <p className="font-semibold text-[#2a241f]">{teamRoleLabel(assignment.role)} · {assignment.assignmentType === "TEMPORARY" ? "Temporary" : "Permanent"}</p>
                      <p className="text-[#73685f]">{assignment.expiresAt ? `Expires ${new Date(assignment.expiresAt).toLocaleString()}` : "No expiration"}</p>
                    </div>
                    {assignment.role !== "owner" ? <GhostButton type="button" className="!min-h-8 !px-2.5 !py-1 text-[11px]" onClick={() => setRevokeTarget(assignment)} disabled={busy}>Revoke</GhostButton> : null}
                  </div>
                ))}
              </div>
            </div>
            <form id="role-assignment-form" noValidate onSubmit={(event) => void assignRole(event)} className="space-y-4">
              <label className="block text-[11px] font-semibold text-[#655b53]">
                Role
                <select value={delegationRole} onChange={(event) => setDelegationRole(event.target.value)} className="field mt-1.5">
                  {ROLES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-[#655b53]">
                Assignment type
                <select value={delegationType} onChange={(event) => setDelegationType(event.target.value as "PERMANENT" | "TEMPORARY")} className="field mt-1.5">
                  <option value="TEMPORARY">Temporary delegation</option>
                  <option value="PERMANENT">Permanent role</option>
                </select>
              </label>
              {delegationType === "TEMPORARY" ? (
                <label className="block text-[11px] font-semibold text-[#655b53]">
                  Expiration
                  <input type="datetime-local" required value={delegationExpiresAt} onChange={(event) => setDelegationExpiresAt(event.target.value)} className="field mt-1.5" />
                </label>
              ) : null}
              <label className="block text-[11px] font-semibold text-[#655b53]">
                Reason
                <textarea value={delegationReason} onChange={(event) => setDelegationReason(event.target.value)} className="field mt-1.5 min-h-20" maxLength={240} placeholder="Temporary coverage while hiring a replacement" />
              </label>
              {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
            </form>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={temporaryCredential !== null}
        onClose={closeTemporaryCredential}
        title="Temporary password"
        description={
          temporaryCredential
            ? `Share this password securely with ${temporaryCredential.name} (${temporaryCredential.email}). It will not be shown again after you close this dialog.`
            : undefined
        }
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <GhostButton type="button" onClick={() => void copyTemporaryPassword()}>
              Copy temporary password
            </GhostButton>
            <PrimaryButton type="button" onClick={closeTemporaryCredential}>
              Close temporary password
            </PrimaryButton>
          </div>
        }
      >
        {temporaryCredential ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#b9dfca] bg-[#f0faf5] px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#1f8a5b]">Display once</p>
              <p data-ui="temporary-password-value" className="font-data mt-2 break-all text-sm font-semibold text-[#17130f]">
                {temporaryCredential.password}
              </p>
            </div>
            <p className="text-[11px] leading-5 text-[#655b53]">
              Closing this dialog clears the password from this page. NexPOS does not store it in browser storage or the URL.
            </p>
            {copyStatus ? <p role="status" className="text-[11px] font-medium text-[#655b53]">{copyStatus}</p> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={pinTarget !== null}
        onClose={() => {
          if (busy) return;
          setPinTarget(null);
          setApprovalPin("");
          setApprovalPinConfirm("");
          setError("");
        }}
        title={pinTarget?.approvalPinSet ? "Rotate approval PIN" : "Set approval PIN"}
        description={pinTarget ? `Create a six-digit in-context approval PIN for ${pinTarget.name}. The PIN is scoped to this business and is never displayed again.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton type="button" disabled={busy} onClick={() => setPinTarget(null)}>Cancel</GhostButton>
            <PrimaryButton type="submit" form="team-approval-pin-form" disabled={busy}>
              {busy ? "Saving…" : pinTarget?.approvalPinSet ? "Rotate PIN" : "Set PIN"}
            </PrimaryButton>
          </div>
        }
      >
        <form id="team-approval-pin-form" noValidate onSubmit={(event) => void saveApprovalPin(event)} className="space-y-4">
          <div className="rounded-xl border border-[#f0e2d7] bg-[#fff8f3] p-4 text-[11px] leading-5 text-[#6d6057]">
            This PIN authorizes protected POS actions for this owner or manager. NexPOS stores only a one-way hash. Do not reuse a banking, card, or device PIN.
          </div>
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Six-digit approval PIN
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={approvalPin}
              onChange={(event) => setApprovalPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="field font-data mt-1.5 tracking-[0.35em]"
              placeholder="••••••"
            />
          </label>
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Confirm approval PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={approvalPinConfirm}
              onChange={(event) => setApprovalPinConfirm(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="field font-data mt-1.5 tracking-[0.35em]"
              placeholder="••••••"
            />
          </label>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={deactivateTarget !== null}
        title="Deactivate team member?"
        description="This removes the active membership for this business. Historical sales and audit records stay intact."
        confirmLabel="Deactivate"
        busy={busy}
        onCancel={() => setDeactivateTarget(null)}
        onConfirm={() => void deactivateMember()}
        details={deactivateTarget ? <span>{deactivateTarget.name} · {deactivateTarget.email}</span> : undefined}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke role assignment?"
        description="This removes the selected role from the member while preserving the assignment and audit history."
        confirmLabel="Revoke role"
        busy={busy}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void revokeRole()}
        details={revokeTarget ? <span>{teamRoleLabel(revokeTarget.role)} · {revokeTarget.assignmentType}</span> : undefined}
      />
    </AppShell>
  );
}
