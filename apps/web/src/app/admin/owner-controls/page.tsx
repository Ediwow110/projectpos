"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { MetricCard, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, StatusPill } from "../../../components/ui";
import { OwnerFinancialPolicies } from "../../../components/OwnerFinancialPolicies";
import { OwnerActivityLog } from "../../../components/OwnerActivityLog";
import { OwnerDiscountPolicies } from "../../../components/OwnerDiscountPolicies";
import { apiFetch } from "../../../lib/api";
import { errorText } from "../../../lib/billing";
import {
  canRevokeAccountSession,
  ownerControlSummary,
  revokeAccountSession,
  type AccountSession,
} from "../../../lib/owner-controls";
import type { TeamMemberRow } from "../../../lib/team-view";

interface Profile {
  userId: string;
  role: string;
  businessName?: string;
}

interface Branch {
  id: string;
  name: string;
  isActive: boolean;
}

interface RolePermissionRow {
  role: string;
  permissions: string[];
}

interface OwnerApprovalRequest {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
}

const APPROVAL_LABELS: Record<string, string> = {
  value_adjustment: "Stored value adjustment",
  refund: "Refund approval",
  sale_refund: "Refund approval",
  sale_void: "Sale void request",
  shift_close: "Shift close request",
  discount: "Discount override",
  inventory_movement: "Inventory movement",
  inventory_adjustment: "Inventory adjustment",
};

const SENSITIVE_ROLE_PERMISSIONS = [
  { key: "price.edit", label: "Edit selling prices" },
  { key: "cost.view", label: "View product costs" },
  { key: "discount.override", label: "Override discounts" },
  { key: "sale.refund", label: "Issue refunds" },
  { key: "stored_value.adjust", label: "Adjust stored value" },
  { key: "gift_card.manage", label: "Manage gift cards" },
  { key: "inventory.adjust", label: "Adjust inventory" },
  { key: "user.manage", label: "Manage team members" },
  { key: "settings.write", label: "Change business settings" },
  { key: "export.run", label: "Export business reports" },
] as const;

const OWNER_ACTIONS = [
  { href: "/team", title: "Team access", detail: "Invite and deactivate members; manage eligible approval PINs.", marker: "01" },
  { href: "/branches", title: "Locations", detail: "Manage branches and review their active status.", marker: "02" },
  { href: "/registers", title: "Registers", detail: "Manage tills used by staff and their shifts.", marker: "03" },
  { href: "/admin/loyalty", title: "Loyalty policy", detail: "Review the existing rewards configuration.", marker: "04" },
  { href: "/admin/online-ordering", title: "Online ordering", detail: "Review pickup, delivery, and web-order settings.", marker: "05" },
  { href: "/reports/sales", title: "Sales insights", detail: "Review authoritative sales and reporting data.", marker: "06" },
] as const;

const ROLE_GUIDANCE = [
  {
    role: "Owner",
    detail: "Business administration and sensitive actions.",
    scope: "Full owner role",
    tone: "ok" as const,
  },
  {
    role: "Manager",
    detail: "Operations and approval actions, within policy.",
    scope: "Fixed template",
    tone: "info" as const,
  },
  {
    role: "Cashier",
    detail: "Sales, own shifts and permitted customer operations.",
    scope: "Fixed template",
    tone: "info" as const,
  },
  {
    role: "Inventory",
    detail: "Stock and procurement. Review existing grants before assigning.",
    scope: "Review scope",
    tone: "warn" as const,
  },
];

export default function OwnerControlsPage(): JSX.Element {
  const [targetSession, setTargetSession] = useState<AccountSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const profile = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Profile>("/api/v1/me"),
    retry: false,
  });
  // Only owners may request membership records from this screen.
  const isOwner = profile.data?.role === "owner";
  const memberships = useQuery({
    queryKey: ["memberships"],
    queryFn: () => apiFetch<{ items: TeamMemberRow[] }>("/api/v1/memberships"),
    enabled: isOwner,
    retry: false,
  });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: Branch[] }>("/api/v1/branches"),
    enabled: isOwner,
    retry: false,
  });
  const sessions = useQuery({
    queryKey: ["account-sessions"],
    queryFn: () => apiFetch<{ sessions: AccountSession[] }>("/api/v1/auth/sessions"),
    enabled: isOwner,
    retry: false,
  });
  const permissionRoles = useQuery({
    queryKey: ["owner-role-permissions"],
    queryFn: () => apiFetch<{ items: RolePermissionRow[] }>("/api/v1/memberships/role-permissions"),
    enabled: isOwner,
    retry: false,
  });
  const approvals = useQuery({
    queryKey: ["owner-approval-requests"],
    queryFn: () => apiFetch<{ requests: OwnerApprovalRequest[] }>("/api/v1/approvals/requests"),
    enabled: isOwner,
    retry: false,
  });

  const summary = ownerControlSummary(memberships.data?.items ?? [], branches.data?.items ?? []);
  const loadingCounts = memberships.isLoading || branches.isLoading;
  const pendingApprovals = (approvals.data?.requests ?? []).filter((request) => request.status === "PENDING");

  async function confirmRevoke(): Promise<void> {
    if (!targetSession || !canRevokeAccountSession(targetSession) || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await revokeAccountSession(targetSession.id);
      setTargetSession(null);
      setMessage("Session revoked. That session must sign in again.");
      await sessions.refetch();
    } catch (cause) {
      setError(errorText(cause, "Could not revoke this session."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell businessName={profile.data?.businessName} role={profile.data?.role} atlasOwner>
      <main className="mx-auto w-full max-w-none space-y-7 px-4 pb-12 pt-8 sm:px-8 lg:pt-9 xl:px-[38px]">
        <header className="space-y-2">
          <p className="font-data text-[11px] font-medium tracking-[0.05em] text-[var(--color-atlas-accent-strong)]">OWNER CONTROLS / OWNER</p>
          <h1 className="font-display text-[29px] font-semibold tracking-tight text-[#202826]">Owner Control Center</h1>
          <p className="text-[13px] leading-6 text-[#758078]">Review the requests and access settings that your account is authorized to manage.</p>
        </header>

        {!profile.isLoading && !isOwner ? (
          <Panel className="border-[#f1d6ad] bg-[#fff8ea] p-6">
            <SectionHeader
              title="Owner access required"
              description="These business-wide controls are available only to the owner. Your existing workspace permissions remain unchanged."
            />
          </Panel>
        ) : null}

        {isOwner ? (
          <>
            <section aria-label="Owner overview" className="grid gap-4 sm:grid-cols-3">
              {[
                { label: "TEAM ACCOUNTS", value: memberships.isLoading ? "—" : memberships.isError ? "Unavailable" : String(summary.staffMembers + summary.ownerSeats), detail: "Current business memberships" },
                { label: "SENSITIVE REQUESTS", value: approvals.isLoading ? "—" : approvals.isError ? "Unavailable" : String(pendingApprovals.length), detail: "Pending requests in your approval scope" },
                { label: "ACTIVE BRANCHES", value: branches.isLoading ? "—" : branches.isError ? "Unavailable" : String(summary.activeBranches), detail: "Active business branches, not staff assignments" },
              ].map((item) => (
                <div key={item.label} className="min-h-[119px] rounded-xl border border-[#e5e9e3] bg-white px-[18px] py-4">
                  <p className="text-[11px] font-semibold text-[#758078]">{item.label}</p>
                  <p className="mt-1 font-display text-[28px] font-semibold text-[#202826]">{item.value}</p>
                  <p className="mt-1 text-[12px] text-[#758078]">{item.detail}</p>
                </div>
              ))}
            </section>
            <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_311px]">
              <section id="owner-approvals" aria-labelledby="owner-attention-title" className="flex min-h-[436px] flex-col rounded-[13px] border border-[#e5e9e3] bg-white p-5 sm:p-6">
                <h2 id="owner-attention-title" className="font-display text-[21px] font-semibold text-[#202826]">Your attention</h2>
                <p className="mt-2 text-[14px] text-[#758078]">{approvals.isLoading ? "Checking protected requests…" : approvals.isError ? "Approval requests could not be loaded." : pendingApprovals.length > 0 ? `${pendingApprovals.length} pending request${pendingApprovals.length === 1 ? "" : "s"} in your authorized queue.` : "No pending approval requests in your scope."}</p>
                {approvals.isError ? <button type="button" onClick={() => void approvals.refetch()} className="mt-3 self-start text-sm font-semibold text-[#b74945] underline">Try again</button> : null}
                <ul className="mt-5 space-y-3">
                  {pendingApprovals.slice(0, 3).map((item, index) => (
                    <li key={item.id} className="flex min-h-[77px] items-center gap-4 rounded-[9px] bg-[#fbfcfa] px-4">
                      <span aria-hidden className="grid size-[35px] shrink-0 place-items-center rounded-[9px] bg-[#fff1ef] font-data text-xs text-[#b74945]">{String(index + 1).padStart(2, "0")}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-[#202826]">{APPROVAL_LABELS[item.kind] ?? item.kind.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-[12px] text-[#758078]">Request awaiting an authorized decision</p>
                      </div>
                      <span className="rounded-md bg-[#fcf1df] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-atlas-warning-strong)]">PENDING</span>
                    </li>
                  ))}
                </ul>
                <Link href="/customer-concerns" className="mt-auto self-end rounded-lg bg-[#29332d] px-6 py-3 text-center text-[13px] font-semibold text-white transition hover:bg-[#405247] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
                  Open approvals
                </Link>
                <p className="mt-2 text-right text-[11px] text-[#758078]">Protected decisions remain in their authorized workflows.</p>
              </section>
              <section aria-labelledby="owner-quick-controls-title" className="min-h-[436px] rounded-[13px] border border-[#e5e9e3] bg-white p-5">
                <h2 id="owner-quick-controls-title" className="font-display text-[21px] font-semibold text-[#202826]">Access & policies</h2>
                <div className="mt-8 space-y-3">
                  {[
                    { title: "Team permissions", detail: "Set access per employee", href: "/team" },
                    { title: "Branch assignments", detail: "Limit working locations", href: "/team" },
                    { title: "Financial policies", detail: "Approval thresholds", href: "#financial-policies" },
                    { title: "Activity audit", detail: "Review sensitive changes", href: "#activity-audit" },
                  ].map((item) => (
                    <Link key={item.title} href={item.href} className="block rounded-lg bg-[#f0f3ef] px-3 py-2.5 transition-colors hover:bg-[#e5e9e3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
                      <span className="block text-[14px] font-semibold text-[#202826]">{item.title} <span aria-hidden>→</span></span>
                      <span className="mt-0.5 block text-[12px] text-[#758078]">{item.detail}</span>
                    </Link>
                  ))}
                </div>
              </section>
            </div>
            <section aria-label="Additional owner account context" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Staff" value={loadingCounts ? "—" : summary.staffMembers} icon="◎" meta="Non-owner memberships" />
              <MetricCard label="Owner seats" value={loadingCounts ? "—" : summary.ownerSeats} icon="◆" tone="success" meta="Protected business access" />
              <MetricCard label="Active branches" value={loadingCounts ? "—" : summary.activeBranches} icon="⌘" tone="info" meta="Current locations" />
              <MetricCard
                label="Account sessions"
                value={sessions.isLoading ? "—" : (sessions.data?.sessions.length ?? "—")}
                icon="◷"
                tone="warning"
                meta="Your account only, not staff sessions"
              />
            </section>

            {(memberships.isError || branches.isError) ? (
              <p role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-4 py-3 text-sm text-[#a53b3b]">
                Some business counts could not load. Open the relevant management page to retry.
              </p>
            ) : null}

            <section aria-label="Owner administration" className="space-y-3">
              <SectionHeader
                title="Business administration"
                description="Every destination below opens an existing, working NexPOS workflow."
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {OWNER_ACTIONS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group rounded-2xl border border-[#e5e9e3] bg-white p-5 shadow-[0_8px_24px_-16px_rgb(32_40_38/0.18)] transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-[#da614c] hover:shadow-[0_12px_25px_-16px_rgb(32_40_38/0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#da614c] motion-reduce:transform-none"
                  >
                    <span className="font-data text-xs text-[var(--color-atlas-accent-strong)]">{item.marker}</span>
                    <h2 className="font-display mt-3 text-lg font-semibold text-[#202826]">{item.title} <span aria-hidden>↗</span></h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-atlas-muted-strong)]">{item.detail}</p>
                  </Link>
                ))}
              </div>
            </section>

            <div className="grid items-start gap-5 lg:grid-cols-[1.08fr_0.92fr]">
              <section id="security-sessions" className="scroll-mt-24">
              <Panel className="p-5">
                <SectionHeader
                  title="Staff permission overview"
                  description="Role grants are server-defined. Owners can remove individual staff permissions from Team, but cannot add permissions outside their role."
                  action={<Link href="/team" className="text-xs font-semibold text-[var(--color-atlas-accent-strong)] hover:underline">Manage team →</Link>}
                />
                <ul className="mt-5 space-y-3">
                  {ROLE_GUIDANCE.map((item) => (
                    <li key={item.role} className="rounded-xl border border-[#e5e9e3] bg-[#f7f8f5] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-sm text-[#202826]">{item.role}</strong>
                        <StatusPill tone={item.tone}>{item.scope}</StatusPill>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-[var(--color-atlas-muted-strong)]">{item.detail}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 rounded-lg bg-[#fcf1df] p-3 text-xs leading-5 text-[#836027]">
                  Inventory's existing default role may include sensitive grants. Review its actual server permissions before delegating price, discount or stored-value operations. Custom templates and individual branch assignments need separate API enforcement.
                </p>
              </Panel>

              <Panel className="p-5">
                <SectionHeader
                  title="Your active sessions"
                  description="Review and revoke sessions belonging to your account. This is not a staff-wide session console."
                />
                {message ? <p role="status" className="mt-4 rounded-lg bg-[#e8f4ec] p-3 text-sm text-[#267552]">{message}</p> : null}
                {error ? <p role="alert" className="mt-4 rounded-lg bg-[#fff1ef] p-3 text-sm text-[#b74945]">{error}</p> : null}
                {sessions.isLoading ? <p role="status" className="mt-5 text-sm text-[var(--color-atlas-muted-strong)]">Loading sessions…</p> : null}
                {sessions.isError ? (
                  <div className="mt-4 space-y-2">
                    <p role="alert" className="text-sm text-[#b74945]">Sessions could not load.</p>
                    <GhostButton type="button" onClick={() => void sessions.refetch()}>Try again</GhostButton>
                  </div>
                ) : null}
                {sessions.data?.sessions.length === 0 ? <p className="mt-5 text-sm text-[var(--color-atlas-muted-strong)]">No sessions returned.</p> : null}
                <ul className="mt-4 space-y-3">
                  {(sessions.data?.sessions ?? []).map((session) => (
                    <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e5e9e3] p-3">
                      <div>
                        <StatusPill tone={session.current ? "ok" : "info"}>{session.current ? "Current session" : "Other session"}</StatusPill>
                        <p className="mt-2 text-xs text-[var(--color-atlas-muted-strong)]">
                          Expires {new Date(session.expiresAt).toLocaleString("en-PH")}
                        </p>
                      </div>
                      {canRevokeAccountSession(session) ? (
                        <GhostButton type="button" onClick={() => { setError(""); setTargetSession(session); }}>Revoke</GhostButton>
                      ) : <span className="text-xs text-[var(--color-atlas-muted-strong)]">Use Sign out to end this session</span>}
                    </li>
                  ))}
                </ul>
              </Panel>
              </section>
            </div>

            <Panel className="p-5">
              <SectionHeader
                title="Effective server permissions"
                description="Read-only base role templates. Individual deny-only restrictions are configured in Team → Permissions."
              />
              {permissionRoles.isLoading ? <p role="status" className="mt-4 text-sm text-[var(--color-atlas-muted-strong)]">Loading permissions…</p> : null}
              {permissionRoles.isError ? <p role="alert" className="mt-4 text-sm text-[#b74945]">Could not load the current permission policy.</p> : null}
              {permissionRoles.data ? (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <caption className="sr-only">Current backend permissions by role</caption>
                    <thead>
                      <tr className="border-b border-[#e5e9e3] text-[var(--color-atlas-muted-strong)]">
                        <th scope="col" className="px-3 py-3">Sensitive action</th>
                        {permissionRoles.data.items.map((role) => (
                          <th scope="col" key={role.role} className="px-3 py-3 capitalize">{role.role}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {SENSITIVE_ROLE_PERMISSIONS.map((permission) => (
                        <tr key={permission.key} className="border-b border-[#e5e9e3]/70">
                          <th scope="row" className="px-3 py-3 font-medium text-[#202826]">{permission.label}</th>
                          {permissionRoles.data.items.map((role) => {
                            const allowed = role.permissions.includes(permission.key);
                            return (
                              <td key={role.role} className="px-3 py-3">
                                <StatusPill tone={allowed ? "ok" : "bad"}>
                                  {allowed ? "Allowed" : "Not granted"}
                                </StatusPill>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <p className="mt-4 text-xs leading-5 text-[var(--color-atlas-muted-strong)]">
                The matrix reflects role grants, not approval thresholds, branch context, or additional server checks.
                Sensitive actions may still require a distinct manager approval or re-authentication.
              </p>
            </Panel>

            <Panel className="p-5">
              <SectionHeader
                title="Advanced access — still being developed"
                description="Branch/register isolation and custom approval rules need deeper server-side authorization changes."
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ["Branch isolation", "Cross-branch data reads and register access require additional enforcement."],
                  ["Discount / void policies", "Distinct approval thresholds beyond the existing refund engine."],
                  ["Audit snapshots", "Owner feed intentionally omits raw before/after details for privacy."],
                ].map(([title, detail]) => (
                  <div key={title} className="rounded-xl border border-[#e5e9e3] bg-[#f7f8f5] p-4">
                    <h3 className="text-sm font-semibold text-[#202826]">{title}</h3>
                    <p className="mt-2 text-xs leading-5 text-[var(--color-atlas-muted-strong)]">{detail}</p>
                  </div>
                ))}
              </div>
            </Panel>
            <div id="financial-policies" className="scroll-mt-24"><OwnerFinancialPolicies /></div>
            <OwnerDiscountPolicies />
            <div id="activity-audit" className="scroll-mt-24"><OwnerActivityLog /></div>
          </>
        ) : null}
      </main>

      <ConfirmDialog
        open={targetSession !== null}
        title="Revoke account session?"
        description="This will sign out the selected session. It will not revoke this browser's current session."
        confirmLabel="Revoke session"
        busy={busy}
        onCancel={() => { if (!busy) setTargetSession(null); }}
        onConfirm={() => void confirmRevoke()}
      />
    </AppShell>
  );
}
