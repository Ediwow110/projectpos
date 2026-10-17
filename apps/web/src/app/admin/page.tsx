"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { PageHeader, Panel, SectionHeader } from "../../components/premium";
import { apiFetch } from "../../lib/api";
import { businessAdminDestinationsForRole } from "../../lib/admin-destinations";
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
  const destinations = businessAdminDestinationsForRole(role);

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role} atlasApprovals={role === "manager"}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Administration / Help"
          title="Administration & Help"
          description="Keep lower-frequency workspace controls discoverable without crowding daily selling and inventory workflows."
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
          <section className="grid gap-4 sm:grid-cols-2" aria-label="Administration destinations">
            {destinations.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-xl border border-[#e5e9e3] bg-white p-5 shadow-[0_3px_11px_rgba(20,38,31,0.04)] transition hover:-translate-y-0.5 hover:border-[#b0c5b6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552] focus-visible:ring-offset-2 motion-reduce:transform-none"
              >
                <span aria-hidden className="grid h-10 w-10 place-items-center rounded-xl bg-[#e9f4ec] font-data text-sm font-semibold text-[#267552]">{item.icon}</span>
                <h2 className="font-display mt-4 text-[17px] font-semibold text-[#202826]">{item.title}</h2>
                <p className="mt-2 text-[12px] leading-5 text-[#53615a]">{item.description}</p>
                <span className="mt-4 inline-flex text-[11px] font-semibold text-[#267552]">Open {item.title} →</span>
              </Link>
            ))}
          </section>
        ) : null}

        <Panel className="p-5">
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
              <div key={title} className="rounded-xl border border-[#eee4db] bg-[#fcf8f3] p-4">
                <h3 className="font-display text-[13px] font-semibold text-[#2a241f]">{title}</h3>
                <p className="mt-2 text-[11px] leading-5 text-[#73685f]">{copy}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="p-5">
          <SectionHeader
            title="POS operating hints"
            description="NexPOS is designed for repeated keyboard and scanner use during a shift."
          />
          <p className="mt-4 text-[12px] leading-6 text-[#655b53]">
            Search or scan from the POS product field, choose the register before checkout, and use the visible payment controls rather than retrying an uncertain provider payment. The system tour can be restarted whenever a workflow is unfamiliar.
          </p>
          <Link href="/pos" className="mt-4 inline-flex text-[11px] font-semibold text-[#e44e34] hover:text-[#c33e29]">
            Return to POS →
          </Link>
        </Panel>
      </main>
    </AppShell>
  );
}
