"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { DataTableFrame, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import { errorText, trialDaysLeft, usagePct } from "../../lib/billing";

interface Me {
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

interface UsageSlice {
  used: number;
  limit: number | null;
}

interface Subscription {
  planKey: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  usage: {
    users: UsageSlice;
    products: UsageSlice;
    registers: UsageSlice;
    branches: UsageSlice;
    salesMonthly: number;
  };
}

interface Invoice {
  id: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  currency: string;
  status: string;
}

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  revokedAt: string | null;
  expiresAt: string | null;
}

const ALL_SCOPES = ["sales:read", "catalog:read", "catalog:write", "reports:read", "inventory:read"];
const MANAGE_ROLES = new Set(["owner", "manager"]);

function planLabel(planKey: string): string {
  return planKey
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }): JSX.Element {
  const pct = usagePct(used, limit);
  const width = pct === null ? 18 : Math.max(2, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold text-[#2a241f]">{label}</span>
        <span className="font-data text-[9px] text-[#73685f]">
          {used}{limit === null ? " · unlimited" : " / " + limit}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#efe7df]">
        <div className="h-full rounded-full bg-[#f35d3f]" style={{ width: width + "%" }} />
      </div>
    </div>
  );
}

function invoiceAmount(invoice: Invoice): string {
  return (invoice.amountMinor / 100).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " " + invoice.currency;
}

export default function BillingPage(): JSX.Element {
  const [tokenName, setTokenName] = useState("");
  const [tokenScopes, setTokenScopes] = useState<string[]>(["sales:read"]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const subQuery = useQuery({
    queryKey: ["billing-subscription"],
    queryFn: () => apiFetch<Subscription>("/api/v1/billing/subscription"),
    retry: false,
  });
  const invoicesQuery = useQuery({
    queryKey: ["billing-invoices"],
    queryFn: () => apiFetch<{ items: Invoice[] }>("/api/v1/billing/invoices"),
    retry: false,
  });
  const tokensQuery = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => apiFetch<{ items: TokenRow[] }>("/api/v1/apitokens"),
    retry: false,
  });

  const manageable = MANAGE_ROLES.has(meQuery.data?.role ?? "cashier");
  const sub = subQuery.data;
  const days = sub ? trialDaysLeft(sub.trialEndsAt) : null;

  async function mintToken(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setNewSecret(null);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      const out = await apiFetch<{ secret: string }>("/api/v1/apitokens", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ name: tokenName, scopes: tokenScopes }) },
      });
      setNewSecret(out.secret);
      setTokenName("");
      await tokensQuery.refetch();
    } catch (err) {
      setError(errorText(err, "Mint failed"));
    }
  }

  async function revokeToken(id: string): Promise<void> {
    setError("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/apitokens/" + id + "/revoke", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({}) },
      });
      await tokensQuery.refetch();
    } catch (err) {
      setError(errorText(err, "Revoke failed"));
    }
  }

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Account / Subscription"
          title="Billing"
          description="Plan status, usage, invoices, and API access — using only values returned by your billing and account APIs."
        />

        {subQuery.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading subscription…</Panel> : null}
        {subQuery.isError ? (
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5">
            <p role="alert" className="text-sm font-medium text-[#c43e3e]">{errorText(subQuery.error, "Could not load your subscription.")}</p>
          </Panel>
        ) : null}

        {sub ? (
          <div className="grid gap-4 xl:grid-cols-[1.35fr_.85fr]">
            <section className="overflow-hidden rounded-[18px] bg-[#1b1714] p-6 text-white shadow-[0_14px_34px_-12px_rgb(26_18_13/0.24)]">
              <p className="font-data text-[9px] font-medium uppercase tracking-[0.16em] text-[#ff8a6b]">Current plan</p>
              <h2 className="font-display mt-3 text-3xl font-bold">{planLabel(sub.planKey) || sub.planKey}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusPill tone={sub.status === "active" ? "ok" : sub.status === "trialing" ? "info" : "warn"}>
                  {sub.status}
                </StatusPill>
                {days !== null && sub.status === "trialing" ? <span className="text-[11px] text-[#c4b8af]">{days} trial day(s) left</span> : null}
              </div>
              <p className="mt-8 text-[11px] text-[#b8aaa0]">
                {sub.currentPeriodEnd ? "Current period ends " + new Date(sub.currentPeriodEnd).toLocaleDateString("en-PH") : "Current period end is not provided."}
              </p>
              <p className="mt-2 text-[10px] text-[#83776f]">Plan price is not shown because the subscription API does not return one.</p>
            </section>

            <Panel className="p-5">
              <SectionHeader title="Usage this period" description="Current usage against the limits returned by your plan." />
              <div className="mt-5 space-y-5">
                <UsageMeter label="Users" used={sub.usage.users.used} limit={sub.usage.users.limit} />
                <UsageMeter label="Products" used={sub.usage.products.used} limit={sub.usage.products.limit} />
                <UsageMeter label="Registers" used={sub.usage.registers.used} limit={sub.usage.registers.limit} />
                <UsageMeter label="Branches" used={sub.usage.branches.used} limit={sub.usage.branches.limit} />
                <div className="flex items-center justify-between rounded-xl bg-[#fcf8f3] p-3">
                  <span className="text-[11px] font-semibold text-[#2a241f]">Sales this month</span>
                  <span className="font-data text-sm font-semibold">{sub.usage.salesMonthly.toLocaleString("en-PH")}</span>
                </div>
              </div>
            </Panel>
          </div>
        ) : null}

        <DataTableFrame>
          <div className="px-5 py-4">
            <h2 className="font-display text-base font-semibold">Invoices</h2>
            <p className="mt-1 text-[11px] text-[#7a6f66]">Billing records returned by the invoice endpoint.</p>
          </div>
          {invoicesQuery.isLoading ? <p className="px-5 pb-6 text-sm text-[#73685f]">Loading invoices…</p> : null}
          {invoicesQuery.isError ? <p role="alert" className="mx-5 mb-5 rounded-xl bg-[#fff0f0] p-3 text-sm text-[#c43e3e]">{errorText(invoicesQuery.error, "Could not load invoices.")}</p> : null}
          {!invoicesQuery.isError && (invoicesQuery.data?.items.length ?? 0) === 0 ? <p className="px-5 pb-8 text-sm text-[#8b8077]">No invoices yet.</p> : null}
          {(invoicesQuery.data?.items.length ?? 0) > 0 ? (
            <table className="premium-table min-w-[760px] text-left text-[12px]">
              <thead>
                <tr>
                  <th className="px-5 pb-3">Invoice</th>
                  <th className="px-5 pb-3">Period</th>
                  <th className="px-5 pb-3 text-right">Amount</th>
                  <th className="px-5 pb-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {(invoicesQuery.data?.items ?? []).map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="font-data px-5 py-3 font-medium">{invoice.id.slice(0, 10)}</td>
                    <td className="px-5 py-3 text-[#73685f]">{invoice.periodStart.slice(0, 10)} → {invoice.periodEnd.slice(0, 10)}</td>
                    <td className="font-data px-5 py-3 text-right">{invoiceAmount(invoice)}</td>
                    <td className="px-5 py-3 text-right"><StatusPill tone={invoice.status.toLowerCase() === "paid" ? "ok" : "warn"}>{invoice.status}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </DataTableFrame>

        <Panel className="p-5">
          <SectionHeader title="API tokens" description="Account access tokens are shown separately from subscription billing because they are security-sensitive credentials." />
          {tokensQuery.isLoading ? <p className="mt-4 text-sm text-[#73685f]">Loading API tokens…</p> : null}
          {tokensQuery.isError ? <p role="alert" className="mt-4 text-sm text-[#c43e3e]">{errorText(tokensQuery.error, "Could not load API tokens.")}</p> : null}
          {newSecret !== null ? (
            <div role="status" className="mt-4 rounded-xl border border-[#efd6a5] bg-[#fff4df] p-4">
              <p className="text-[11px] font-semibold text-[#8a5606]">New token secret — shown once</p>
              <code className="font-data mt-2 block break-all text-xs text-[#2a241f]">{newSecret}</code>
            </div>
          ) : null}
          <div className="mt-4 space-y-2">
            {(tokensQuery.data?.items ?? []).map((token) => (
              <div key={token.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-[#fcf8f3] p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-[#2a241f]">{token.name}</p>
                  <p className="font-data mt-1 truncate text-[9px] text-[#73685f]">{token.prefix} · {token.scopes.join(", ")}</p>
                </div>
                <StatusPill tone={token.revokedAt ? "warn" : "ok"}>{token.revokedAt ? "Revoked" : "Active"}</StatusPill>
                {manageable && !token.revokedAt ? <GhostButton type="button" className="!min-h-8 !px-3 !py-1.5 text-xs" onClick={() => void revokeToken(token.id)}>Revoke</GhostButton> : null}
              </div>
            ))}
          </div>

          {manageable ? (
            <form onSubmit={(event) => void mintToken(event)} className="mt-5 border-t border-[#eee6de] pt-5">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <label className="text-[11px] font-semibold text-[#655b53]">
                  Token name
                  <input value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="Nightly export" className="field mt-1.5" />
                </label>
                <PrimaryButton type="submit" disabled={tokenName.trim() === "" || tokenScopes.length === 0} className="self-end">Mint token</PrimaryButton>
              </div>
              <fieldset className="mt-3">
                <legend className="text-[11px] font-semibold text-[#655b53]">Scopes</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ALL_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-center gap-2 rounded-full border border-[#e4d9d0] bg-white px-3 py-2 text-[10px] font-medium text-[#51483f]">
                      <input
                        type="checkbox"
                        checked={tokenScopes.includes(scope)}
                        onChange={(event) =>
                          setTokenScopes(event.target.checked ? [...tokenScopes, scope] : tokenScopes.filter((entry) => entry !== scope))
                        }
                      />
                      {scope}
                    </label>
                  ))}
                </div>
              </fieldset>
            </form>
          ) : <p className="mt-4 rounded-xl bg-[#fff4df] p-3 text-[11px] font-medium text-[#8a5606]">Only owners and managers can manage API tokens.</p>}
        </Panel>

        {error !== "" ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2 text-sm font-medium text-[#c43e3e]">{error}</p> : null}
        <Link href="/" className="text-[11px] font-semibold text-[#e44e34]">← Back to dashboard</Link>
      </main>
    </AppShell>
  );
}
