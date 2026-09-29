"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Modal } from "../../components/Modal";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { canEditCatalog } from "../../lib/catalog";

interface Category {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

interface Me {
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

export default function CategoriesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<Category | null>(null);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });
  const listQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ items: Category[] }>("/api/v1/categories"),
    retry: false,
  });

  const editable = canEditCatalog(meQuery.data?.role ?? "cashier");
  const items = listQuery.data?.items ?? [];
  const activeCount = items.filter((category) => category.isActive).length;
  const archivedCount = items.length - activeCount;

  async function createCategory(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("VALIDATION: Category name is required.");
      return;
    }
    setBusy(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/categories", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
          }),
        },
      });
      setName("");
      setDescription("");
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCategory(): Promise<void> {
    if (!pendingCategory) return;
    setError("");
    setBusy(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/categories/${pendingCategory.id}`, {
        csrfToken: csrf.csrfToken,
        init: {
          method: "PATCH",
          body: JSON.stringify({ isActive: !pendingCategory.isActive }),
        },
      });
      setPendingCategory(null);
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Catalog / Organization"
          title="Categories"
          description="Organize the catalog without changing the products themselves. Categories can be archived and restored without deleting history."
          actions={
            <>
              <Link href="/products" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">
                ← Products
              </Link>
              {editable ? <PrimaryButton type="button" onClick={() => setCreateOpen(true)}>+ Add category</PrimaryButton> : null}
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-3" aria-label="Category summary">
          <MetricCard label="Categories" value={items.length} icon="◇" meta="All catalog groups" />
          <MetricCard label="Active" value={activeCount} icon="✓" tone="success" meta="Available for new products" />
          <MetricCard label="Archived" value={archivedCount} icon="—" tone={archivedCount > 0 ? "warning" : "success"} meta="Preserved for history" />
        </section>

        {error ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p></Panel> : null}

        <DataTableFrame>
          <div className="px-5 py-4">
            <SectionHeader title="Catalog categories" description="Active categories can be assigned when creating or editing products." />
          </div>
          {listQuery.isLoading ? <p className="px-5 pb-6 text-sm text-[#73685f]">Loading categories…</p> : null}
          {listQuery.isError ? <p role="alert" className="px-5 pb-6 text-sm font-medium text-[#c43e3e]">Could not load categories.</p> : null}
          {listQuery.data && items.length === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No categories yet.</p> : null}
          {items.length > 0 ? (
            <table className="premium-table min-w-[640px] text-left text-[12px]">
              <thead>
                <tr>
                  <th className="px-5 pb-3">Category</th>
                  <th className="px-5 pb-3">Description</th>
                  <th className="px-5 pb-3 text-right">Status</th>
                  <th className="px-5 pb-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((category) => (
                  <tr key={category.id}>
                    <td className="px-5 py-3 font-semibold text-[#2a241f]">{category.name}</td>
                    <td className="px-5 py-3 text-[#73685f]">{category.description ?? "—"}</td>
                    <td className="px-5 py-3 text-right"><StatusPill tone={category.isActive ? "ok" : "warn"}>{category.isActive ? "Active" : "Archived"}</StatusPill></td>
                    <td className="px-5 py-3 text-right">
                      {editable ? (
                        <GhostButton type="button" onClick={() => setPendingCategory(category)}>
                          {category.isActive ? "Archive" : "Restore"}
                        </GhostButton>
                      ) : <span className="text-[11px] text-[#9a8d83]">Read only</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </DataTableFrame>
      </main>

      <Modal
        open={createOpen}
        onClose={() => !busy && setCreateOpen(false)}
        title="Add category"
        description="Create a reusable catalog category. Products remain uncategorized until explicitly assigned."
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton type="button" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</GhostButton>
            <PrimaryButton type="submit" form="create-category-form" disabled={busy || name.trim() === ""}>{busy ? "Adding…" : "Add category"}</PrimaryButton>
          </div>
        }
      >
        <form id="create-category-form" noValidate onSubmit={(event) => void createCategory(event)} className="space-y-4">
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Category name
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} className="field mt-1.5" placeholder="Beverages" />
          </label>
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Description (optional)
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={4} className="field mt-1.5 resize-none" placeholder="How this group is used" />
          </label>
          {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingCategory !== null}
        onCancel={() => !busy && setPendingCategory(null)}
        onConfirm={() => void toggleCategory()}
        busy={busy}
        tone={pendingCategory?.isActive ? "danger" : "primary"}
        title={pendingCategory?.isActive ? "Archive category?" : "Restore category?"}
        description={pendingCategory?.isActive ? "Existing product history is preserved. The category will no longer be available for new assignments." : "The category will become available for product assignment again."}
        confirmLabel={pendingCategory?.isActive ? "Archive category" : "Restore category"}
        details={pendingCategory ? <strong className="text-[#2a241f]">{pendingCategory.name}</strong> : null}
      />
    </AppShell>
  );
}
