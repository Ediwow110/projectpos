"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { PageHeader, Panel, SectionHeader } from "../../components/premium";
import { apiFetch } from "../../lib/api";
import { atlasAdminDestinationsForRole } from "../../lib/atlas-admin-destinations";
import { AdminHelpActions } from "./AdminHelpActions";

interface Me {
  role: string;
  businessName?: string;
}

export default function AdminPage(): JSX.Element {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });
  const role = meQuery.data?.role ?? "cashier";
  const canAdmin = role === "owner" || role === "manager";
  const destinations = atlasAdminDestinationsForRole(role);
  const isOwner = role === "owner";
  const isManager = role === "manager";

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role} atlasOwner={isOwner} atlasManager={isManager}>
      <main className="mx-auto w-full max-w-[1380px] space-y-6 px-4 pb-12 pt-8 sm:px-7 xl:px-[38px]">
        <PageHeader
          eyebrow={isOwner ? "OWNER / ADMINISTRATION" : isManager ? "MANAGER / ADMINISTRATION" : "WORKSPACE / HELP"}
          title={isOwner ? "Owner administration" : isManager ? "Manager operations" : "Administration & Help"}
          description={isOwner
            ? "Business controls and authorized account decisions in one workspace."
            : isManager
              ? "Review operations, approvals, shifts and inventory within your assigned authority."
              : "Find operational guidance without exposing restricted business settings."}
          actions={<AdminHelpActions />}
        />
        {canAdmin ? (
          <section data-ui="atlas-business-admin-scope" aria-label="Business administration scope"
            className="rounded-xl border border-[#e5e9e3] bg-white px-5 py-4">
            <h2 className="font-display text-[16px] font-semibold text-[#202826]">Business administration</h2>
            <p className="mt-2 text-[12px] leading-5 text-[#53615a]">
              These controls apply to your authorized business. The platform tenant directory is separate and is not available through this workspace.
            </p>
          </section>
        ) : null}

        {!meQuery.isLoading && !canAdmin ? (
          <Panel className="border-[#f1d6ad] bg-[#fff8ea] p-5">
            <SectionHeader
              title="Administration access is not available for this role"
              description="You can still restart the system tour here. Management actions remain hidden and the server continues to enforce permissions."
            />
          </Panel>
        ) : null}

        {canAdmin ? (
          <section aria-label="Administration destinations" className="space-y-4">
            <div>
              <h2 className="font-display text-[20px] font-semibold text-[#202826]">{isOwner ? "Owner controls & access" : "Manager work areas"}</h2>
              <p className="mt-1 text-sm text-[var(--color-atlas-muted-strong)]">Actions require the relevant server-side permission; availability may vary by assignment.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {destinations.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex min-h-[175px] flex-col rounded-[14px] border border-[#e5e9e3] bg-white p-5 transition-colors duration-150 hover:border-[#da614c] hover:bg-[#fbfcf9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c] motion-reduce:transition-none"
              >
                <span aria-hidden className="grid size-10 place-items-center rounded-[10px] bg-[#eff2ed] font-data text-base font-semibold text-[#29332d]">{item.icon}</span>
                <h3 className="font-display mt-3 text-[16px] font-semibold text-[#202826]">{item.title}</h3>
                <p className="mt-1.5 text-[12px] leading-5 text-[var(--color-atlas-muted-strong)]">{item.description}</p>
                <span className="mt-auto pt-3 text-[12px] font-semibold text-[var(--color-atlas-accent-strong)]">Open →</span>
              </Link>
            ))}
            </div>
          </section>
        ) : null}

        <Panel className="border-[#e5e9e3] bg-white p-5">
          <SectionHeader
            title="Workspace map"
            description="Use the shell groups as a mental model when you are learning the system."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Sell", "Dashboard, POS, Sales, and Customers for the transaction flow."],
              ["Catalog", "Products, Categories, and Inventory for what you sell and stock."],
              ["Operations", "Registers, Shifts, Transfers, Expenses, Branches, Devices, and Sync."],
              ["Reports", "Sales and operational reporting for review and reconciliation."],
            ].map(([title, copy]) => (
              <div key={title} className="rounded-xl border border-[#e5e9e3] bg-[#f7f8f5] p-4">
                <h3 className="font-display text-[13px] font-semibold text-[#202826]">{title}</h3>
                <p className="mt-2 text-[11px] leading-5 text-[var(--color-atlas-muted-strong)]">{copy}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="border-[#e5e9e3] bg-white p-5">
          <SectionHeader
            title="POS operating hints"
            description="NexPOS is designed for repeated keyboard and scanner use during a shift."
          />
          <p className="mt-4 text-[12px] leading-6 text-[#655b53]">
            Search or scan from the POS product field, choose the register before checkout, and use the visible payment controls rather than retrying an uncertain provider payment. The system tour can be restarted whenever a workflow is unfamiliar.
          </p>
          <Link href="/pos" className="mt-4 inline-flex text-[11px] font-semibold text-[var(--color-atlas-accent-strong)] hover:text-[#c33e29]">
            Return to POS →
          </Link>
        </Panel>
      </main>
    </AppShell>
  );
}
