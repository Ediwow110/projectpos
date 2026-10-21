"use client";

import { useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { PageHeader, Panel, SectionHeader } from "../../components/premium";
import { StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { orderedBusinesses, switchFailureCopy, type BusinessOption } from "../../lib/business-switch";

interface Me {
  role: string;
  businessName?: string;
}

export default function BusinessesPage(): JSX.Element {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const listQuery = useQuery({
    queryKey: ["businesses"],
    queryFn: () => apiFetch<{ items: BusinessOption[] }>("/api/v1/auth/businesses"),
    retry: false,
  });
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const items = orderedBusinesses(listQuery.data?.items ?? []);

  async function switchTo(business: BusinessOption): Promise<void> {
    setError("");
    setBusyId(business.businessId);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/auth/active-business", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ businessId: business.businessId }) },
      });
      // Every screen reads the active tenant server-side, so the only honest
      // follow-up is a reload rather than patching cached queries in place.
      window.location.assign("/");
    } catch (cause) {
      setError(switchFailureCopy(cause));
      setBusyId("");
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Account / Workspaces"
          title="Business workspaces"
          description="Switch the tenant this session works in. Permissions are resolved per business, so your role can differ in each one."
        />

        {error ? (
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-4"><p role="alert" className="text-sm font-medium text-[#c43e3e]">{error}</p></Panel>
        ) : null}

        {listQuery.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading your businesses…</Panel> : null}
        {listQuery.isError ? (
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5">
            <p role="alert" className="text-sm font-medium text-[#c43e3e]">
              {listQuery.error instanceof ApiError ? `${listQuery.error.code}: ${listQuery.error.message}` : "Could not load your businesses."}
            </p>
            <button
              type="button"
              onClick={() => void listQuery.refetch()}
              className="mt-3 min-h-11 rounded-xl border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]"
            >
              Retry
            </button>
          </Panel>
        ) : null}

        {listQuery.data && items.length === 1 ? (
          <Panel className="p-6 text-sm text-[var(--color-atlas-muted-strong)]">
            {items[0]?.name} is the only business this account belongs to. Ask an owner of another business to add you to switch between workspaces.
          </Panel>
        ) : null}

        {items.length > 1 ? (
          <Panel className="p-5">
            <SectionHeader title="Your businesses" description="Switching reloads the workspace so every screen reads from the chosen tenant." />
            <ul className="mt-4 divide-y divide-[#eee6de]">
              {items.map((business) => (
                <li key={business.businessId} className="flex min-h-[61px] flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#2a241f]">{business.name}</p>
                    <p className="mt-1 font-data text-[11px] text-[var(--color-atlas-muted-strong)]">Role in this business: {business.role}</p>
                  </div>
                  {business.active ? (
                    <StatusPill tone="ok">Current workspace</StatusPill>
                  ) : (
                    <button
                      data-ui={`switch-${business.businessId}`}
                      type="button"
                      disabled={busyId !== ""}
                      onClick={() => void switchTo(business)}
                      className="min-h-11 rounded-xl border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyId === business.businessId ? "Switching…" : "Switch to this business"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </main>
    </AppShell>
  );
}
