"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
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

  const summary = ownerControlSummary(memberships.data?.items ?? [], branches.data?.items ?? []);
  const loadingCounts = memberships.isLoading || branches.isLoading;

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
    <AppShell businessName={profile.data?.businessName} role={profile.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-6 px-4 pb-12 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Owner / Control center"
          title="Owner controls"
          description="One place to review staff, business locations, sensitive access and account sessions. Only saved settings and actions supported by NexPOS are interactive."
        />

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
            <section aria-label="Business access summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                    <span className="font-data text-xs text-[#da614c]">{item.marker}</span>
                    <h2 className="font-display mt-3 text-lg font-semibold text-[#202826]">{item.title} <span aria-hidden>↗</span></h2>
                    <p className="mt-2 text-sm leading-6 text-[#707b75]">{item.detail}</p>
                  </Link>
                ))}
              </div>
            </section>

            <div className="grid items-start gap-5 lg:grid-cols-[1.08fr_0.92fr]">
              <Panel className="p-5">
                <SectionHeader
                  title="Staff permission overview"
                  description="Role grants are server-defined. Owners can remove individual staff permissions from Team, but cannot add permissions outside their role."
                  action={<Link href="/team" className="text-xs font-semibold text-[#da614c] hover:underline">Manage team →</Link>}
                />
                <ul className="mt-5 space-y-3">
                  {ROLE_GUIDANCE.map((item) => (
                    <li key={item.role} className="rounded-xl border border-[#e5e9e3] bg-[#f7f8f5] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-sm text-[#202826]">{item.role}</strong>
                        <StatusPill tone={item.tone}>{item.scope}</StatusPill>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-[#707b75]">{item.detail}</p>
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
                {sessions.isLoading ? <p role="status" className="mt-5 text-sm text-[#707b75]">Loading sessions…</p> : null}
                {sessions.isError ? (
                  <div className="mt-4 space-y-2">
                    <p role="alert" className="text-sm text-[#b74945]">Sessions could not load.</p>
                    <GhostButton type="button" onClick={() => void sessions.refetch()}>Try again</GhostButton>
                  </div>
                ) : null}
                {sessions.data?.sessions.length === 0 ? <p className="mt-5 text-sm text-[#707b75]">No sessions returned.</p> : null}
                <ul className="mt-4 space-y-3">
                  {(sessions.data?.sessions ?? []).map((session) => (
                    <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e5e9e3] p-3">
                      <div>
                        <StatusPill tone={session.current ? "ok" : "info"}>{session.current ? "Current session" : "Other session"}</StatusPill>
                        <p className="mt-2 text-xs text-[#707b75]">
                          Expires {new Date(session.expiresAt).toLocaleString("en-PH")}
                        </p>
                      </div>
                      {canRevokeAccountSession(session) ? (
                        <GhostButton type="button" onClick={() => { setError(""); setTargetSession(session); }}>Revoke</GhostButton>
                      ) : <span className="text-xs text-[#707b75]">Use Sign out to end this session</span>}
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            <Panel className="p-5">
              <SectionHeader
                title="Effective server permissions"
                description="Read-only base role templates. Individual deny-only restrictions are configured in Team → Permissions."
              />
              {permissionRoles.isLoading ? <p role="status" className="mt-4 text-sm text-[#707b75]">Loading permissions…</p> : null}
              {permissionRoles.isError ? <p role="alert" className="mt-4 text-sm text-[#b74945]">Could not load the current permission policy.</p> : null}
              {permissionRoles.data ? (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <caption className="sr-only">Current backend permissions by role</caption>
                    <thead>
                      <tr className="border-b border-[#e5e9e3] text-[#707b75]">
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
              <p className="mt-4 text-xs leading-5 text-[#707b75]">
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
                    <p className="mt-2 text-xs leading-5 text-[#707b75]">{detail}</p>
                  </div>
                ))}
              </div>
            </Panel>
            <OwnerFinancialPolicies />
            <OwnerDiscountPolicies />
            <OwnerActivityLog />
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
