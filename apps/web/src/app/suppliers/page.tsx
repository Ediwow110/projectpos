"use client";

import type { FormEvent, JSX } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { Modal } from "../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { requestKey, suppliersPath, supplierStatusLabel, type Supplier } from "../../lib/suppliers";

interface Me { role: string; businessName?: string }
interface SupplierPage { items: Supplier[]; total: number; page: number; pageSize: number }
const WRITE_ROLES = new Set(["owner", "manager", "inventory"]);

export default function SuppliersPage(): JSX.Element {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const listQuery = useQuery({
    queryKey: ["suppliers", query, status, page],
    queryFn: () => apiFetch<SupplierPage>(suppliersPath({ q: query, status, page, pageSize: 20 })),
    retry: false,
  });
  useEffect(() => {
    const sync = (): void => setOnline(navigator.onLine);
    sync(); window.addEventListener("online", sync); window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  const role = meQuery.data?.role ?? "cashier";
  const canWrite = WRITE_ROLES.has(role);
  const data = listQuery.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function createSupplier(event: FormEvent): Promise<void> {
    event.preventDefault(); setError(""); setSuccess("");
    if (!online) { setError("Purchase orders require an internet connection."); return; }
    if (!name.trim()) { setError("VALIDATION: supplier name is required."); return; }
    setBusy(true);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/suppliers", { csrfToken: csrf.csrfToken, init: { method: "POST", headers: { "Idempotency-Key": requestKey("supplier") }, body: JSON.stringify({ name, code: code || undefined, email: email || undefined }) } });
      setName(""); setCode(""); setEmail(""); setCreateOpen(false); setSuccess("Supplier created."); await listQuery.refetch();
    } catch (err) { setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Supplier creation failed."); }
    finally { setBusy(false); }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader eyebrow="Procurement / Vendor records" title="Suppliers" description="Keep supplier contacts and product buying terms ready for controlled purchase orders." actions={canWrite ? <PrimaryButton type="button" onClick={() => { setError(""); setCreateOpen(true); }} disabled={!online}>+ Add supplier</PrimaryButton> : undefined} />
        {!online ? <Panel className="border-[#f2d49e] bg-[#fff4df] p-4"><p role="status" className="text-sm font-medium text-[#8a5606]">Purchase orders require an internet connection. Supplier changes are disabled while offline.</p></Panel> : null}
        {success ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[var(--color-atlas-verified)]">{success}</div> : null}
        <section className="grid gap-4 sm:grid-cols-3" aria-label="Supplier summary">
          <MetricCard label="Visible suppliers" value={data?.total ?? "—"} icon="⌁" meta={status === "active" ? "Active records" : "Current filter"} />
          <MetricCard label="Active" value={data?.items.filter((item) => item.isActive).length ?? "—"} icon="✓" tone="success" meta="Ready for new POs" />
          <MetricCard label="Procurement" value={<Link href="/purchase-orders" className="text-base text-[var(--color-atlas-accent-strong)]">Purchase orders →</Link>} icon="▱" tone="info" meta="Commercial workflow" />
        </section>
        <Panel className="p-5"><SectionHeader title="Find a supplier" description="Search by name or supplier code, and keep inactive records available for history." /><div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]"><label className="text-[11px] font-semibold text-[#655b53]">Search<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Name or code" className="field mt-1.5" /></label><label className="text-[11px] font-semibold text-[#655b53]">Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="field mt-1.5"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All suppliers</option></select></label><GhostButton type="button" className="self-end" onClick={() => { setQuery(""); setStatus("active"); setPage(1); }}>Reset</GhostButton></div></Panel>
        {error && !createOpen ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-4 py-3 text-sm font-medium text-[#c43e3e]">{error}</p> : null}
        <DataTableFrame><div className="px-5 py-4"><SectionHeader title="Supplier directory" description={data ? `${data.total} supplier${data.total === 1 ? "" : "s"} · page ${data.page} of ${pages}` : "Loading supplier records"} /></div>{listQuery.isLoading ? <p className="px-5 pb-8 text-sm text-[#73685f]">Loading suppliers…</p> : null}{listQuery.isError ? <p role="alert" className="px-5 pb-8 text-sm text-[#c43e3e]">Could not load suppliers.</p> : null}{data && data.items.length === 0 && !listQuery.isLoading ? <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">No suppliers match this filter.</p> : null}{data && data.items.length > 0 ? <table className="premium-table min-w-[720px] text-left text-[12px]"><thead><tr><th className="px-5 pb-3">Supplier</th><th className="px-5 pb-3">Contact</th><th className="px-5 pb-3">Code</th><th className="px-5 pb-3 text-right">Status</th><th className="px-5 pb-3 text-right">Open</th></tr></thead><tbody>{data.items.map((supplier) => <tr key={supplier.id} className={!supplier.isActive ? "opacity-65" : undefined}><td className="px-5 py-3"><Link href={`/suppliers/${supplier.id}`} className="font-semibold text-[#2a241f] hover:text-[var(--color-atlas-accent-strong)]">{supplier.name}</Link></td><td className="px-5 py-3 text-[#73685f]">{supplier.contactName || supplier.email || supplier.phone || "—"}</td><td className="font-data px-5 py-3 text-[#73685f]">{supplier.code || "—"}</td><td className="px-5 py-3 text-right"><StatusPill tone={supplier.isActive ? "ok" : "warn"}>{supplierStatusLabel(supplier.isActive)}</StatusPill></td><td className="px-5 py-3 text-right"><Link href={`/suppliers/${supplier.id}`} className="text-[11px] font-semibold text-[var(--color-atlas-accent-strong)]">Review →</Link></td></tr>)}</tbody></table> : null}<div className="flex justify-end gap-2 border-t border-[#eee6de] px-5 py-4"><GhostButton type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</GhostButton><GhostButton type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</GhostButton></div></DataTableFrame>
        {!canWrite ? <Panel className="bg-[#fff4df] p-4 text-[11px] font-medium text-[#8a5606]">Your role can review supplier records but cannot create, edit, or deactivate them.</Panel> : null}
      </main>
      <Modal open={createOpen && canWrite} onClose={() => !busy && setCreateOpen(false)} title="Add supplier" description="Supplier records are commercial setup only; creating one does not affect stock or cash." footer={<div className="flex justify-end gap-2"><GhostButton type="button" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</GhostButton><PrimaryButton type="submit" form="supplier-create-form" disabled={busy || !online}>{busy ? "Creating…" : "Create supplier"}</PrimaryButton></div>}><form id="supplier-create-form" onSubmit={(event) => void createSupplier(event)} className="space-y-4"><label className="block text-[11px] font-semibold text-[#655b53]">Supplier name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="field mt-1.5" required /></label><div className="grid gap-4 sm:grid-cols-2"><label className="text-[11px] font-semibold text-[#655b53]">Supplier code<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Optional" className="field mt-1.5" /></label><label className="text-[11px] font-semibold text-[#655b53]">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="buyer@example.com" className="field mt-1.5" /></label></div>{error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}</form></Modal>
    </AppShell>
  );
}
