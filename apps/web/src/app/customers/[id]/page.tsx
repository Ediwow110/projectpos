"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Modal } from "../../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { canManageCustomers } from "../../../lib/customers";

interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  purchaseHistory: Array<{ id: string; receiptNo: string; status: string; totalMinor: number }>;
}

interface Me {
  role: string;
  businessName?: string;
}

function money(minor: number): string {
  return (minor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const detailQuery = useQuery({
    queryKey: ["customer", id],
    queryFn: () => apiFetch<CustomerDetail>(`/api/v1/customers/${id}`),
    retry: false,
  });

  const customer = detailQuery.data;
  const manageable = canManageCustomers(meQuery.data?.role ?? "cashier");
  const purchaseTotal = customer?.purchaseHistory.reduce((sum, sale) => sum + sale.totalMinor, 0) ?? 0;

  useEffect(() => {
    if (!editOpen || !customer) return;
    setName(customer.name);
    setPhone(customer.phone ?? "");
    setEmail(customer.email ?? "");
    setAddress(customer.address ?? "");
    setNotes(customer.notes ?? "");
    setError("");
  }, [editOpen, customer]);

  async function patchCustomer(body: Record<string, unknown>): Promise<void> {
    const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
    await apiFetch(`/api/v1/customers/${id}`, {
      csrfToken: csrf.csrfToken,
      init: { method: "PATCH", body: JSON.stringify(body) },
    });
    await detailQuery.refetch();
  }

  async function saveCustomer(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!name.trim()) {
      setError("VALIDATION: Customer name is required.");
      return;
    }
    setBusy(true);
    try {
      await patchCustomer({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
      });
      setEditOpen(false);
      setSuccess("Customer profile updated.");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function archiveCustomer(): Promise<void> {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await patchCustomer({ isActive: false });
      setArchiveOpen(false);
      setSuccess("Customer profile archived.");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Archive failed");
    } finally {
      setBusy(false);
    }
  }

  if (detailQuery.isError || (!detailQuery.isLoading && !customer)) {
    return (
      <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
        <main className="mx-auto max-w-[1240px] p-6">
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-6">
            <p role="alert" className="text-sm font-medium text-[#c43e3e]">
              {detailQuery.error instanceof ApiError ? `${detailQuery.error.code}: ${detailQuery.error.message}` : "Customer not found."}
            </p>
            <Link href="/customers" className="mt-3 inline-block text-sm font-semibold text-[#e44e34]">← Back to customers</Link>
          </Panel>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Customers / Profile"
          title={customer?.name ?? "Customer"}
          description="Review contact context and purchase history without exposing or fabricating customer ranking metrics."
          actions={
            <>
              <Link href="/customers" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Customers</Link>
              {manageable && customer?.isActive ? <PrimaryButton type="button" onClick={() => setEditOpen(true)}>Edit profile</PrimaryButton> : null}
              {manageable && customer?.isActive ? <GhostButton type="button" onClick={() => setArchiveOpen(true)}>Archive</GhostButton> : null}
            </>
          }
        />

        {customer ? (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Customer summary">
            <MetricCard label="Purchases" value={customer.purchaseHistory.length} icon="▦" meta="Recorded purchase history" />
            <MetricCard label="Purchase total" value={`₱${money(purchaseTotal)}`} icon="₱" tone="info" meta="Historical recorded sales" />
            <MetricCard label="Contact" value={customer.phone || customer.email ? "Available" : "Limited"} icon="☎" tone={customer.phone || customer.email ? "success" : "warning"} meta="Stored profile fields" />
            <MetricCard label="Status" value={<span className="text-base">{customer.isActive ? "Active" : "Archived"}</span>} icon={customer.isActive ? "✓" : "—"} tone={customer.isActive ? "success" : "warning"} meta="Profile lifecycle" />
          </section>
        ) : null}

        {success ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[#1f8a5b]">{success}</div> : null}
        {error ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p></Panel> : null}

        {customer ? (
          <div className="grid gap-4 lg:grid-cols-[.75fr_1.25fr]">
            <Panel className="p-5">
              <SectionHeader title="Profile details" description="Only fields actually stored by the customer service are shown." />
              <dl className="mt-4 space-y-3">
                {[
                  ["Phone", customer.phone ?? "—"],
                  ["Email", customer.email ?? "—"],
                  ["Address", customer.address ?? "—"],
                  ["Notes", customer.notes ?? "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-[#f7f1ea] p-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a8d83]">{label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm font-medium text-[#2a241f]">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4"><StatusPill tone={customer.isActive ? "ok" : "warn"}>{customer.isActive ? "Active profile" : "Archived profile"}</StatusPill></div>
            </Panel>

            <DataTableFrame>
              <div className="px-5 py-4"><SectionHeader title="Purchase history" description="Sales are linked to their authoritative sale records." /></div>
              {customer.purchaseHistory.length === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No purchases recorded.</p> : (
                <table className="premium-table min-w-[620px] text-left text-[12px]">
                  <thead><tr><th className="px-5 pb-3">Receipt</th><th className="px-5 pb-3">Status</th><th className="px-5 pb-3 text-right">Total</th><th className="px-5 pb-3 text-right">Open</th></tr></thead>
                  <tbody>
                    {customer.purchaseHistory.map((sale) => (
                      <tr key={sale.id}>
                        <td className="font-data px-5 py-3 font-semibold text-[#2a241f]">{sale.receiptNo}</td>
                        <td className="px-5 py-3 text-[#73685f]">{sale.status}</td>
                        <td className="font-data px-5 py-3 text-right font-medium">₱{money(sale.totalMinor)}</td>
                        <td className="px-5 py-3 text-right"><Link href={`/sales/${sale.id}`} className="text-[11px] font-semibold text-[#e44e34]">Review →</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </DataTableFrame>
          </div>
        ) : <Panel className="p-6 text-sm text-[#73685f]">Loading customer…</Panel>}
      </main>

      <Modal
        open={editOpen && manageable && customer !== undefined}
        onClose={() => !busy && setEditOpen(false)}
        title="Edit customer"
        description="Update the customer profile. Historical sales remain linked to the same customer record."
        footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setEditOpen(false)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="customer-edit-form" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save profile"}</PrimaryButton></div>}
      >
        <form id="customer-edit-form" noValidate onSubmit={(event) => void saveCustomer(event)} className="space-y-4">
          <label className="block text-[11px] font-semibold text-[#655b53]">Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} className="field mt-1.5" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-[#655b53]">Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={32} inputMode="tel" className="field mt-1.5" /></label>
            <label className="text-[11px] font-semibold text-[#655b53]">Email<input value={email} onChange={(event) => setEmail(event.target.value)} maxLength={160} type="email" className="field mt-1.5" /></label>
          </div>
          <label className="block text-[11px] font-semibold text-[#655b53]">Address<textarea value={address} onChange={(event) => setAddress(event.target.value)} maxLength={300} rows={3} className="field mt-1.5 resize-none" /></label>
          <label className="block text-[11px] font-semibold text-[#655b53]">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} rows={4} className="field mt-1.5 resize-none" /></label>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={archiveOpen && customer !== undefined}
        onCancel={() => !busy && setArchiveOpen(false)}
        onConfirm={() => void archiveCustomer()}
        busy={busy}
        title="Archive customer profile?"
        description="The customer will be removed from active customer searches. Existing sales and purchase history remain linked for audit and reporting."
        confirmLabel="Archive customer"
        details={customer ? <strong className="text-[#2a241f]">{customer.name}</strong> : null}
      />
    </AppShell>
  );
}
