"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TeamBranchAssignmentDialog } from "../../components/TeamBranchAssignmentDialog";
import { TeamRegisterAssignmentDialog } from "../../components/TeamRegisterAssignmentDialog";
import { Modal } from "../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import { errorText } from "../../lib/billing";
import { changeTeamMemberRoleRequest, createTeamMemberRequest, deactivateTeamMemberRequest, loadTeamPermissionRestrictions, saveTeamApprovalPinRequest, saveTeamPermissionRestrictions } from "../../lib/team-api";
import { canChangeMemberRole, canDeactivateMember, canManageApprovalPin, teamRoleLabel, type TeamMemberRow } from "../../lib/team-view";
import { useTeamPageState } from "./use-team-page-state";

interface Me {
  userId: string;
  role: string;
  businessName?: string;
}

const ROLES = [
  { value: "manager", label: "Manager" },
  { value: "cashier", label: "Cashier" },
  { value: "inventory", label: "Inventory" },
] as const;

export default function TeamPage(): JSX.Element {
  const [branchTarget, setBranchTarget] = useState<TeamMemberRow | null>(null);
  const [registerTarget, setRegisterTarget] = useState<TeamMemberRow | null>(null);
  const {
    createOpen, setCreateOpen, name, setName, email, setEmail, role, setRole,
    busy, setBusy, error, setError, success, setSuccess,
    temporaryCredential, setTemporaryCredential, copyStatus, setCopyStatus,
    deactivateTarget, setDeactivateTarget, pinTarget, setPinTarget,
    roleTarget, setRoleTarget, nextRole, setNextRole, roleConfirmation, setRoleConfirmation,
    permissionTarget, setPermissionTarget, permissionOptions, setPermissionOptions,
    deniedPermissions, setDeniedPermissions, permissionConfirmation, setPermissionConfirmation,
    permissionLoading, setPermissionLoading,
    approvalPin, setApprovalPin, approvalPinConfirm, setApprovalPinConfirm,
  } = useTeamPageState();

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
  const mobileMembers = [...members].sort((left, right) => Number(left.role === "owner") - Number(right.role === "owner"));
  const staffCount = members.filter((member) => member.role !== "owner").length;

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

  function closeRoleChange(): void {
    if (busy) return;
    setRoleTarget(null);
    setRoleConfirmation("");
    setError("");
  }

  async function changeMemberRole(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!roleTarget || busy) return;
    if (!canChangeMemberRole(meQuery.data?.userId ?? "", roleTarget) || !roleConfirmation) {
      setError("Select an eligible staff member and confirm your owner account.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await changeTeamMemberRoleRequest(roleTarget.id, nextRole, roleConfirmation);
      setSuccess(`${roleTarget.name}'s role changed to ${teamRoleLabel(nextRole)}. Their previous approval PIN was reset.`);
      setRoleTarget(null);
      await membersQuery.refetch();
    } catch (cause) {
      setError(errorText(cause, "Could not update this staff role."));
    } finally {
      setRoleConfirmation("");
      setBusy(false);
    }
  }

  async function openPermissionRestrictions(member: TeamMemberRow): Promise<void> {
    if (!canChangeMemberRole(meQuery.data?.userId ?? "", member)) return;
    setPermissionTarget(member);
    setPermissionOptions([]);
    setDeniedPermissions([]);
    setPermissionConfirmation("");
    setError("");
    setPermissionLoading(true);
    try {
      const permissions = await loadTeamPermissionRestrictions(member.id);
      setPermissionOptions(permissions.rolePermissions);
      setDeniedPermissions(permissions.deniedPermissions);
    } catch (cause) {
      setError(errorText(cause, "Unable to load employee permissions."));
    } finally {
      setPermissionLoading(false);
    }
  }

  function closePermissionRestrictions(): void {
    if (busy || permissionLoading) return;
    setPermissionTarget(null);
    setPermissionOptions([]);
    setDeniedPermissions([]);
    setPermissionConfirmation("");
    setError("");
  }

  async function savePermissionRestrictions(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!permissionTarget || busy || permissionLoading) return;
    if (!permissionConfirmation || permissionOptions.length === 0) {
      setError("Load the permission policy and confirm your owner password.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await saveTeamPermissionRestrictions(permissionTarget.id, deniedPermissions, permissionConfirmation);
      setSuccess(`Permission restrictions saved for ${permissionTarget.name}.`);
      setPermissionTarget(null);
    } catch (cause) {
      setError(errorText(cause, "Could not update employee restrictions."));
    } finally {
      setPermissionConfirmation("");
      setBusy(false);
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role} atlasOwner>
      <main className="mx-auto w-full max-w-[1240px] space-y-5 px-4 pb-10 pt-5 sm:px-6">
        {isOwner ? <section aria-label="Mobile employee permissions" className="space-y-3 sm:hidden">
          <p className="font-data text-[11px] tracking-[0.07em] text-[var(--color-atlas-accent-strong)]">OWNER / EMPLOYEE ACCESS</p>
          <h1 className="font-display text-[25px] font-semibold tracking-tight text-[#202826]">Employee access</h1>
          <p className="text-[13px] leading-5 text-[var(--color-atlas-muted-strong)]">Choose a staff member to review their role, permission restrictions, and assigned locations.</p>
          <PrimaryButton type="button" className="min-h-11" onClick={() => { resetCreate(); setCreateOpen(true); }}>+ Add team member</PrimaryButton>
        </section> : null}
        <div className={isOwner ? "hidden sm:block" : ""}><PageHeader
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
        /></div>

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
            <section className="hidden gap-4 sm:grid sm:grid-cols-3" aria-label="Team summary">
              <MetricCard label="Active users" value={members.length} icon="◎" meta="Current memberships" />
              <MetricCard label="Staff" value={staffCount} icon="○" tone="info" meta="Non-owner users" />
              <MetricCard label="Owner seats" value={members.filter((member) => member.role === "owner").length} icon="◆" tone="success" meta="Protected role" />
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
              {members.length === 0 && !membersQuery.isLoading ? <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">No active team members.</p> : null}
              {members.length > 0 ? (
                <section className="grid gap-3 px-4 pb-5 sm:hidden" aria-label="Mobile employee access">
                  {mobileMembers.map((member) => {
                    const editable = canChangeMemberRole(meQuery.data?.userId ?? "", member);
                    return <article key={member.id} className="min-w-0 rounded-[11px] border border-[#e5e9e3] bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="break-words font-display text-base font-semibold text-[#202826]">{member.name}</h3>
                          <p className="mt-1 break-all text-xs text-[#73685f]">{member.email}</p>
                        </div>
                        <StatusPill tone={member.role === "owner" ? "ok" : "info"}>{teamRoleLabel(member.role)}</StatusPill>
                      </div>
                      <p className="mt-3 text-xs text-[#655b53]">
                        {editable
                          ? "Employee access: review and restrict permissions, locations, or registers."
                          : member.userId === meQuery.data?.userId
                            ? "Current user · Protected owner access"
                            : "Protected membership"}
                      </p>
                      <p className="mt-3 text-[11px] text-[var(--color-atlas-muted-strong)]">Role-based access is enforced by the server. Use Permissions to review actual allowed and blocked actions.</p>
                      {(editable || canManageApprovalPin(member)) ? <div className="mt-4 grid grid-cols-2 gap-2">
                        {editable ? (
                          <>
                            <GhostButton type="button" onClick={() => void openPermissionRestrictions(member)}>Permissions</GhostButton>
                            <GhostButton type="button" onClick={() => setBranchTarget(member)}>Branch access</GhostButton>
                            <GhostButton type="button" onClick={() => setRegisterTarget(member)}>Register access</GhostButton>
                            <GhostButton type="button" onClick={() => {
                              setError("");
                              setRoleTarget(member);
                              setNextRole(member.role as "manager" | "cashier" | "inventory");
                              setRoleConfirmation("");
                            }}>Change role</GhostButton>
                          </>
                        ) : null}
                        {canManageApprovalPin(member) && <GhostButton type="button" className="col-span-2" onClick={() => {
                          setError("");
                          setPinTarget(member);
                          setApprovalPin("");
                          setApprovalPinConfirm("");
                        }}>{member.approvalPinSet ? "Rotate approval PIN" : "Set approval PIN"}</GhostButton>}
                        {editable && canDeactivateMember(meQuery.data?.userId ?? "", member) && <GhostButton type="button" className="col-span-2" onClick={() => setDeactivateTarget(member)}>Deactivate employee</GhostButton>}
                      </div> : null}
                    </article>;
                  })}
                </section>
              ) : null}
              {members.length > 0 ? (
                <div className="hidden overflow-x-auto sm:block">
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
                        <tr key={member.id}>
                          <td className="px-5 py-3 font-semibold text-[#2a241f]">{member.name}</td>
                          <td className="px-5 py-3 text-[#655b53]">{member.email}</td>
                          <td className="px-5 py-3"><StatusPill tone={member.role === "owner" ? "ok" : "info"}>{teamRoleLabel(member.role)}</StatusPill></td>
                          <td className="px-5 py-3 text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              {canChangeMemberRole(meQuery.data?.userId ?? "", member) ? (
                                <GhostButton type="button" className="!min-h-11 !px-3 !py-1.5 text-xs"
                                  onClick={() => setRegisterTarget(member)}>
                                  Register access
                                </GhostButton>
                              ) : null}
                              {canChangeMemberRole(meQuery.data?.userId ?? "", member) ? (
                                <GhostButton
                                  type="button"
                                  className="!min-h-11 !px-3 !py-1.5 text-xs"
                                  onClick={() => setBranchTarget(member)}
                                >
                                  Branch access
                                </GhostButton>
                              ) : null}
                              {canChangeMemberRole(meQuery.data?.userId ?? "", member) ? (
                                <GhostButton
                                  type="button"
                                  className="!min-h-11 !px-3 !py-1.5 text-xs"
                                  onClick={() => void openPermissionRestrictions(member)}
                                >
                                  Permissions
                                </GhostButton>
                              ) : null}
                              {canChangeMemberRole(meQuery.data?.userId ?? "", member) ? (
                                <GhostButton
                                  type="button"
                                  className="!min-h-11 !px-3 !py-1.5 text-xs"
                                  onClick={() => {
                                    setError("");
                                    setRoleTarget(member);
                                    setNextRole(member.role as "manager" | "cashier" | "inventory");
                                    setRoleConfirmation("");
                                  }}
                                >
                                  Change role
                                </GhostButton>
                              ) : null}
                              {canManageApprovalPin(member) ? (
                                <GhostButton
                                  type="button"
                                  className="!min-h-11 !px-3 !py-1.5 text-xs"
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
                              {canDeactivateMember(meQuery.data?.userId ?? "", member) ? (
                                <GhostButton type="button" className="!min-h-11 !px-3 !py-1.5 text-xs" onClick={() => setDeactivateTarget(member)}>
                                  Deactivate
                                </GhostButton>
                              ) : !canManageApprovalPin(member) ? (
                                <span className="self-center text-[10px] font-medium text-[var(--color-atlas-muted-strong)]">
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

      <TeamBranchAssignmentDialog
        member={branchTarget}
        onClose={() => setBranchTarget(null)}
        onSaved={(name) => setSuccess(`Branch access updated for ${name}.`)}
      />
      <TeamRegisterAssignmentDialog
        member={registerTarget}
        onClose={() => setRegisterTarget(null)}
        onSaved={(name) => setSuccess(`Register access updated for ${name}.`)}
      />

      <Modal
        open={permissionTarget !== null}
        onClose={closePermissionRestrictions}
        title="Employee permission restrictions"
        description={permissionTarget ? `Restrict existing ${teamRoleLabel(permissionTarget.role)} permissions for ${permissionTarget.name}. You cannot add permissions that the role does not already grant.` : undefined}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <GhostButton type="button" onClick={closePermissionRestrictions} disabled={busy || permissionLoading}>Cancel</GhostButton>
            <PrimaryButton type="submit" form="team-permission-restrictions" disabled={busy || permissionLoading || permissionOptions.length === 0}>
              {busy ? "Saving…" : "Verify & save restrictions"}
            </PrimaryButton>
          </div>
        }
      >
        <form id="team-permission-restrictions" onSubmit={(event) => void savePermissionRestrictions(event)} className="space-y-4">
          <p className="rounded-xl border border-[#f1d6ad] bg-[#fff8ea] p-3 text-xs leading-5 text-[#836027]">
            Checked permissions remain available within the employee&apos;s existing role. Unchecking a permission removes it
            immediately from the employee&apos;s server authorization. Owner roles cannot be restricted here.
            Manager approvals and other security checks may still apply.
          </p>
          {permissionLoading ? <p role="status" className="text-sm text-[var(--color-atlas-muted-strong)]">Loading current permissions…</p> : null}
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-[#e5e9e3] p-3">
            {permissionOptions.map((permission) => {
              const enabled = !deniedPermissions.includes(permission);
              return (
                <label key={permission} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-[#f7f8f5] px-3 py-2 text-sm text-[#202826]">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={busy || permissionLoading}
                    onChange={(event) => setDeniedPermissions((previous) => (
                      event.target.checked
                        ? previous.filter((entry) => entry !== permission)
                        : [...previous.filter((entry) => entry !== permission), permission]
                    ))}
                    className="size-4 accent-[#da614c]"
                  />
                  <span className="min-w-0 flex-1 break-all font-mono text-xs">{permission}</span>
                  <span className={"rounded-md px-2 py-1 font-data text-[10px] font-semibold " + (enabled ? "bg-[#e8f4ec] text-[#267552]" : "bg-[#fcf1df] text-[var(--color-atlas-warning-strong)]")}>{enabled ? "Allowed" : "Blocked"}</span>
                </label>
              );
            })}
          </div>
          <label className="block text-xs font-semibold text-[#655b53]">
            Confirm with your owner password
            <input
              type="password"
              autoComplete="current-password"
              className="field mt-1.5"
              required
              value={permissionConfirmation}
              onChange={(event) => setPermissionConfirmation(event.target.value)}
            />
          </label>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] p-3 text-xs text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

      <Modal
        open={roleTarget !== null}
        onClose={closeRoleChange}
        title="Change staff role"
        description={roleTarget ? `Set ${roleTarget.name}'s business role. Updated permissions take effect on their next authenticated request.` : undefined}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <GhostButton type="button" onClick={closeRoleChange} disabled={busy}>Cancel</GhostButton>
            <PrimaryButton type="submit" form="team-change-role-form" disabled={busy}>
              {busy ? "Saving…" : "Verify and update role"}
            </PrimaryButton>
          </div>
        }
      >
        <form id="team-change-role-form" onSubmit={(event) => void changeMemberRole(event)} className="space-y-4">
          <label className="block text-xs font-semibold text-[#655b53]">
            New role
            <select
              className="field mt-1.5"
              value={nextRole}
              onChange={(event) => setNextRole(event.target.value as "manager" | "cashier" | "inventory")}
            >
              {ROLES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
          <p className="rounded-xl border border-[#f1d6ad] bg-[#fff8ea] p-3 text-xs leading-5 text-[#836027]">
            Roles carry server-defined permissions. The current Inventory template has broad sensitive grants.
            Role changes clear any previously configured manager approval PIN. Owner memberships are protected.
          </p>
          <label className="block text-xs font-semibold text-[#655b53]">
            Confirm with your account password
            <input
              type="password"
              autoComplete="current-password"
              required
              className="field mt-1.5"
              value={roleConfirmation}
              onChange={(event) => setRoleConfirmation(event.target.value)}
            />
          </label>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2 text-xs text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

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
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-atlas-verified)]">Display once</p>
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
    </AppShell>
  );
}
