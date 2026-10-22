"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { AtlasInventorySafeguards } from "../../../components/AtlasInventorySafeguards";
import { PageHeader } from "../../../components/premium";
import { apiFetch } from "../../../lib/api";

interface Me {
  role: string;
  businessName?: string;
  permissions: string[];
}

const restrictedActions = [
  { label: "Edit retail pricing", scope: "Use the product management workflow", href: "/products" },
  { label: "Authorize a sale refund", scope: "Use the manager approval and refund workflow", href: "/customer-concerns" },
  { label: "Adjust counted stock", scope: "Use an authorized stock-count workflow", href: "/inventory/counts" },
] as const;

export default function InventoryAccessPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const role = me.data?.role ?? "cashier";
  const inventoryPrivilege = me.data?.permissions.includes("inventory.adjust") ?? false;
  return <AppShell role={role} businessName={me.data?.businessName} atlasInventory>
    <main className="mx-auto w-full max-w-none space-y-5 px-4 pb-10 pt-8 sm:px-7">
      {/* Every inventory page owns its h1 through the shared page header; the
          safeguards block below it stays a section heading. */}
      <PageHeader
        eyebrow="Inventory / Access control"
        title="Manager-protected adjustments"
        description="What inventory authority does not include, and where every protected action is decided instead."
      />
      <AtlasInventorySafeguards title="Restricted action" description="Inventory permissions never automatically confer commercial or financial approval authority." rules={["Every protected operation is authorized by the API.", "Unavailable actions have an explicit route to the responsible workflow.", "Manager or owner verification cannot be bypassed by sharing credentials."]}>
        <h3 className="font-display text-[22px] font-semibold text-[#202826]">Access restrictions</h3>
        <p className="mt-2 text-sm text-[var(--color-atlas-muted-strong)]">Your role and assigned permissions determine what you can do. These entries explain the existing workflows; they do not grant access.</p>
        {me.isPending ? <p role="status" className="mt-5 text-sm text-[var(--color-atlas-muted-strong)]">Checking permissions…</p> : me.isError ? <p role="alert" className="mt-5 text-sm text-[#a34132]">Your permissions could not be verified. No protected controls are available.</p> : <div className="mt-5 space-y-2">
          {restrictedActions.map((item, index) => <div key={item.label} className="grid gap-2 rounded-lg bg-[#f7f8f5] p-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div><p className="font-semibold text-[#202826]">{item.label}</p><p className="mt-1 text-xs text-[var(--color-atlas-muted-strong)]">{item.scope}</p></div>
            <span className={"rounded-md px-2.5 py-1 text-xs font-semibold " + (index === 2 && inventoryPrivilege ? "bg-[#e9f4ec] text-[#267552]" : "bg-[#fff1ef] text-[#a34132]")}>{index === 2 && inventoryPrivilege ? "Permission granted" : "Separate authorization"}</span>
          </div>)}
        </div>}
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/inventory" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#29332d] px-5 text-sm font-semibold text-white hover:bg-[#35423d]">Back to inventory</Link>
          <Link href="/inventory/counts" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#dce3dc] bg-white px-5 text-sm font-semibold text-[#202826] hover:bg-[#f0f3ef]">Stock count workflow</Link>
        </div>
      </AtlasInventorySafeguards>
    </main>
  </AppShell>;
}
