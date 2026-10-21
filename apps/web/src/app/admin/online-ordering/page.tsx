"use client";

import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { PageHeader, Panel, SectionHeader } from "../../../components/premium";
import { GhostButton, PrimaryButton } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { onlineOrderingSettingsPayload, orderCapabilitiesForRole } from "../../../lib/orders";

interface Me { role: string; businessName?: string }
interface Branch { id: string; name: string; isActive: boolean }
interface BusinessPayload {
  storefrontKey: string | null;
  settings: Record<string, unknown>;
}

export default function OnlineOrderingSettingsPage(): JSX.Element {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const role = meQuery.data?.role ?? "";
  const canManage = orderCapabilitiesForRole(role).settings;
  const businessQuery = useQuery({
    queryKey: ["business-online-ordering"],
    queryFn: () => apiFetch<BusinessPayload>("/api/v1/business"),
    enabled: canManage,
    retry: false,
  });
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: Branch[] }>("/api/v1/branches"),
    enabled: canManage,
    retry: false,
  });
  const [enabled, setEnabled] = useState(false);
  const [pickupBranchIds, setPickupBranchIds] = useState<string[]>([]);
  const [deliveryBranchId, setDeliveryBranchId] = useState("");
  const [deliveryFeePesos, setDeliveryFeePesos] = useState("0.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const settings = businessQuery.data?.settings;
    if (!settings) return;
    setEnabled(settings["onlineOrderingEnabled"] === true);
    setPickupBranchIds(
      Array.isArray(settings["onlinePickupBranchIds"])
        ? settings["onlinePickupBranchIds"].filter((value): value is string => typeof value === "string")
        : [],
    );
    setDeliveryBranchId(typeof settings["onlineFulfillmentBranchId"] === "string" ? settings["onlineFulfillmentBranchId"] : "");
    setDeliveryFeePesos(
      ((typeof settings["deliveryFlatFeeMinor"] === "number" ? settings["deliveryFlatFeeMinor"] : 0) / 100).toFixed(2),
    );
  }, [businessQuery.data]);

  const activeBranches = useMemo(
    () => (branchesQuery.data?.items ?? []).filter((branch) => branch.isActive),
    [branchesQuery.data?.items],
  );
  const storefrontLink =
    enabled && businessQuery.data?.storefrontKey && typeof window !== "undefined"
      ? window.location.origin + "/order?storefront=" + businessQuery.data.storefrontKey
      : "";

  function togglePickup(id: string): void {
    setPickupBranchIds((current) => current.includes(id) ? current.filter((row) => row !== id) : [...current, id]);
    setSuccess("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canManage || busy) return;
    setError("");
    setSuccess("");
    let payload;
    try {
      payload = onlineOrderingSettingsPayload({
        enabled,
        pickupBranchIds,
        deliveryBranchId: deliveryBranchId || null,
        deliveryFeePesos,
      });
    } catch {
      setError("Enter a valid non-negative delivery fee.");
      return;
    }
    if (enabled && pickupBranchIds.length === 0 && !deliveryBranchId) {
      setError("Enable at least one pickup branch or a delivery branch before publishing online ordering.");
      return;
    }
    setBusy(true);
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/business/settings", {
        csrfToken: csrf.csrfToken,
        init: { method: "PATCH", body: JSON.stringify(payload) },
      });
      await businessQuery.refetch();
      setSuccess(enabled ? "Online ordering settings saved and storefront access is active." : "Online ordering settings saved. The storefront is disabled.");
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 403
          ? "You do not have permission to change online ordering settings."
          : cause instanceof ApiError ? cause.message : "Online ordering settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyStorefront(): Promise<void> {
    if (!storefrontLink) return;
    try {
      await navigator.clipboard.writeText(storefrontLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy the storefront link. Select and copy it manually.");
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role}>
      <main className="mx-auto max-w-[1000px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Administration / Commerce"
          title="Online ordering"
          description="Publish branch-aware pickup and delivery ordering without changing NexPOS financial authority or inventory rules."
          actions={<Link href="/orders" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">Open Orders</Link>}
        />

        {!meQuery.isLoading && !canManage ? (
          <Panel className="border-[#f1d6ad] bg-[#fff8ea] p-5">
            <SectionHeader title="Online ordering settings are restricted" description="Your role can work with Orders but cannot change business storefront configuration." />
          </Panel>
        ) : null}

        {canManage && (businessQuery.isLoading || branchesQuery.isLoading) ? <Panel className="p-6"><p role="status" className="text-sm text-[#73685f]">Loading online ordering settings…</p></Panel> : null}
        {canManage && (businessQuery.isError || branchesQuery.isError) ? <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5"><p role="alert" className="text-sm font-medium text-[#c43e3e]">Online ordering settings could not be loaded.</p></Panel> : null}

        {canManage && businessQuery.data && branchesQuery.data ? (
          <form noValidate onSubmit={(event) => void save(event)} className="space-y-5">
            {success ? <div role="status" className="rounded-xl border border-[#cfe9dc] bg-[#eaf7f0] px-4 py-3 text-sm font-medium text-[var(--color-atlas-verified)]">{success}</div> : null}
            {error ? <div role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-4 py-3 text-sm font-medium text-[#c43e3e]">{error}</div> : null}

            <Panel className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <SectionHeader title="Storefront availability" description="Turning this on mints a stable public storefront key if the business does not already have one." />
                <label className="inline-flex min-h-11 items-center gap-3 rounded-[10px] border border-[#e4d9d0] bg-[#fffdfb] px-4 text-sm font-semibold">
                  <input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setSuccess(""); }} />
                  Enable online ordering
                </label>
              </div>

              {enabled && businessQuery.data.storefrontKey ? (
                <div className="mt-5 rounded-xl bg-[#f7f1ea] p-4">
                  <p className="text-[11px] font-semibold text-[#655b53]">Customer storefront link</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input aria-label="Customer storefront link" readOnly value={storefrontLink} className="field font-data text-[11px]" />
                    <GhostButton type="button" onClick={() => void copyStorefront()}>{copied ? "Copied" : "Copy link"}</GhostButton>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-[#8d8178]">The link contains only the public storefront key. It never includes the business tenant ID.</p>
                </div>
              ) : null}
            </Panel>

            <Panel className="p-5 sm:p-6">
              <SectionHeader title="Pickup branches" description="Customers must choose one enabled branch before product availability is shown." />
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {activeBranches.map((branch) => (
                  <label key={branch.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-[#e8ddd4] px-4 py-3 text-sm">
                    <input type="checkbox" checked={pickupBranchIds.includes(branch.id)} onChange={() => togglePickup(branch.id)} />
                    <span className="font-semibold text-[#2a241f]">{branch.name}</span>
                  </label>
                ))}
              </div>
              {activeBranches.length === 0 ? <p className="mt-4 text-sm text-[#8d8178]">No active branches are available.</p> : null}
            </Panel>

            <Panel className="p-5 sm:p-6">
              <SectionHeader title="Manual delivery" description="Choose the single branch that fulfills delivery Orders. Delivery remains prepaid-only in Phase 22." />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-[11px] font-semibold text-[#655b53]">
                  Delivery fulfillment branch
                  <select className="field mt-2" value={deliveryBranchId} onChange={(event) => { setDeliveryBranchId(event.target.value); setSuccess(""); }}>
                    <option value="">Delivery disabled</option>
                    {activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                <label className="block text-[11px] font-semibold text-[#655b53]">
                  Flat delivery fee (PHP)
                  <input className="field mt-2 font-data" inputMode="decimal" value={deliveryFeePesos} onChange={(event) => { setDeliveryFeePesos(event.target.value); setSuccess(""); }} />
                </label>
              </div>
            </Panel>

            <div className="sticky bottom-3 flex justify-end rounded-2xl border border-[#eee4db] bg-[#fcf8f3]/95 p-3 shadow-[0_10px_28px_-12px_rgb(28_20_15/0.14)]">
              <PrimaryButton type="submit" disabled={busy}>{busy ? "Saving…" : "Save online ordering"}</PrimaryButton>
            </div>
          </form>
        ) : null}
      </main>
    </AppShell>
  );
}
