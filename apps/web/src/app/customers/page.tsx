"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { Modal } from "../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import { RequestError } from "../../lib/billing-ui";
import { canManageCustomers, customerLabel } from "../../lib/customers";

interface Me {
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
}

export default function CustomersPage(): JSX.Element {
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const listQuery = useQuery({
    queryKey: ["customers", q],
    queryFn: () => apiFetch<{ items: CustomerRow[]; total: number }>(
      "/api/v1/customers?" + new URLSearchParams({ q, active: "true", page: "1", pageSize: "20" }).toString(),
    ),
    retry: false,
  });

  const manageable = canManageCustomers(meQuery.data?.role ?? "cashier");

  async function create(): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/customers", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            name,
            ...(phone.trim() !== "" ? { phone: phone.trim() } : {}),
          }),
        },
      });
      setName("");
      setPhone("");
      setCreateOpen(false);
      setSuccess("Customer profile created.");
      await listQuery.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const items = listQuery.data?.items ?? [];
  const visibleWithPhone = items.filter((customer) => customer.phone !== null && customer.phone.trim() !== "").length;

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Customers / Relationships"
          title="Customers"
          description="Keep useful customer context close to the sale without turning people into a leaderboard."
          actions={
            <>
              <Link href="/sales" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">
                View sales
              </Link>
              {manageable ? <PrimaryButton type="button" onClick={() => { setError(null); setSuccess(""); setCreateOpen(true); }}>+ Add customer</PrimaryButton> : null}
            </>
          }
        />

        {success ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[#1f8a5b]">{success}</div> : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Customer summary">
          <MetricCard label="Matching customers" value={(listQuery.data?.total ?? 0).toLocaleString("en-PH")} icon="○" meta="Current search" />
          <MetricCard label="Visible profiles" value={items.length} icon="▦" tone="info" meta="Current page" />
          <MetricCard label="With phone" value={visibleWithPhone} icon="☎" tone="success" meta="Visible profiles only" />
          <MetricCard label="Management access" value={manageable ? "Enabled" : "Read only"} icon="◇" tone={manageable ? "success" : "warning"} meta="Based on your role" />
        </section>

        <Panel className="p-5">
          <SectionHeader title="Find a customer" description="Search by the customer information supported by the current customer endpoint." />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void listQuery.refetch();
            }}
            className="mt-4 flex flex-col gap-3 sm:flex-row"
          >
            <label className="flex-1 text-[11px] font-semibold text-[#655b53]">
              Search name or phone
              <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Ana, 0917…" className="field mt-1.5" />
            </label>
            <PrimaryButton type="submit" className="self-end">Search</PrimaryButton>
          </form>
        </Panel>

        <DataTableFrame>
            <div className="px-5 py-4">
              <h2 className="font-display text-base font-semibold">Customer directory</h2>
              <p className="mt-1 text-[11px] text-[#7a6f66]">Profiles returned by the active customer search.</p>
            </div>
            {listQuery.isLoading ? <p className="px-5 pb-6 text-sm text-[#73685f]">Loading customers…</p> : null}
            {listQuery.data && items.length === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No customers found.</p> : null}
            {items.length > 0 ? (
              <table className="premium-table min-w-[620px] text-left text-[12px]">
                <thead>
                  <tr>
                    <th className="px-5 pb-3">Customer</th>
                    <th className="px-5 pb-3">Phone</th>
                    <th className="px-5 pb-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((customer) => (
                    <tr key={customer.id}>
                      <td className="px-5 py-3">
                        <Link href={"/customers/" + customer.id} className="font-semibold text-[#2a241f] hover:text-[#d94a30]">
                          {customerLabel(customer)}
                        </Link>
                      </td>
                      <td className="font-data px-5 py-3 text-[#73685f]">{customer.phone ?? "—"}</td>
                      <td className="px-5 py-3 text-right"><StatusPill tone={customer.isActive ? "ok" : "warn"}>{customer.isActive ? "Active" : "Archived"}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
        </DataTableFrame>
        {!manageable ? <Panel className="bg-[#fff4df] p-4 text-[11px] font-medium text-[#8a5606]">Only owners and managers can create or edit customer profiles.</Panel> : null}
        <RequestError error={listQuery.isError ? listQuery.error : null} fallback="Could not load customers." />
      </main>

      <Modal
        open={createOpen && manageable}
        onClose={() => !saving && setCreateOpen(false)}
        title="Add customer"
        description="Create a lightweight customer profile without leaving the directory. You can add richer details later from the customer record."
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton type="button" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</GhostButton>
            <PrimaryButton type="button" onClick={() => void create()} disabled={saving || name.trim() === ""}>{saving ? "Creating…" : "Create customer"}</PrimaryButton>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Name
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" className="field mt-1.5" />
          </label>
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Phone (optional)
            <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="+63…" className="field mt-1.5" />
          </label>
          <RequestError error={error} fallback="Create failed" />
        </div>
      </Modal>
    </AppShell>
  );
}
