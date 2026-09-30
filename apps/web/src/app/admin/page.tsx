"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { PageHeader, Panel, SectionHeader } from "../../components/premium";
import { apiFetch } from "../../lib/api";
import { AdminHelpActions } from "./AdminHelpActions";

interface Me {
  role: string;
  businessName?: string;
}

const OWNER_DESTINATIONS = [
  { href: "/team", title: "Team", description: "Add staff, review roles, and deactivate access.", icon: "◎" },
  { href: "/devices", title: "Devices", description: "Register, review, and revoke trusted tills or workstations.", icon: "▦" },
  { href: "/branches", title: "Branches", description: "Manage the store locations used by operational records.", icon: "⌘" },
  { href: "/registers", title: "Registers", description: "Maintain the registers used for shifts and selling.", icon: "▣" },
  { href: "/printers", title: "Printers", description: "Pair receipt printers, choose defaults, test output, and review print queues.", icon: "▧" },
] as const;

export default function AdminPage(): JSX.Element {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });
  const role = meQuery.data?.role ?? "cashier";
  const canAdmin = role === "owner" || role === "manager";
  const destinations = role === "owner"
    ? OWNER_DESTINATIONS
    : OWNER_DESTINATIONS.filter((item) => item.href !== "/team");

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Administration / Help"
          title="Administration & Help"
          description="Keep lower-frequency workspace controls discoverable without crowding daily selling and inventory workflows."
          actions={<AdminHelpActions />}
        />

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
                className="group rounded-2xl border border-[#eee4db] bg-white p-5 shadow-[0_10px_28px_-10px_rgb(28_20_15/0.10)] transition hover:-translate-y-0.5 hover:border-[#f2b8a9] hover:shadow-[0_14px_32px_-12px_rgb(28_20_15/0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f35d3f] focus-visible:ring-offset-2 motion-reduce:transform-none"
              >
                <span aria-hidden className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff0ea] font-data text-sm font-semibold text-[#e44e34]">{item.icon}</span>
                <h2 className="font-display mt-4 text-[17px] font-semibold text-[#17130f]">{item.title}</h2>
                <p className="mt-2 text-[12px] leading-5 text-[#73685f]">{item.description}</p>
                <span className="mt-4 inline-flex text-[11px] font-semibold text-[#e44e34]">Open {item.title} →</span>
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
