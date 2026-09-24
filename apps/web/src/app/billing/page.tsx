"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { trialDaysLeft, usagePct } from "../../lib/billing";
import { money } from "../../lib/reports";

interface Me {
  role: string;
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

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }): JSX.Element {
  const pct = usagePct(used, limit);
  return (
    <li style={{ fontVariantNumeric: "tabular-nums" }}>
      {label}: {used}{limit === null ? " (unlimited)" : ` / ${limit} (${pct}%)`}
    </li>
  );
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

  async function mintToken(e: React.FormEvent): Promise<void> {
    e.preventDefault();
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
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Mint failed");
    }
  }

  async function revokeToken(id: string): Promise<void> {
    setError("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/apitokens/${id}/revoke`, {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({}) },
      });
      await tokensQuery.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Revoke failed");
    }
  }

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Billing</h1>
      {subQuery.isLoading && <p>Loading subscription…</p>}
      {sub && (
        <section aria-label="Plan">
          <h2>Plan: {sub.planKey}</h2>
          <p style={{ fontVariantNumeric: "tabular-nums" }}>
            Status: {sub.status}
            {days !== null && sub.status === "trialing" ? ` — ${days} trial day(s) left` : ""}
          </p>
          <ul>
            <Meter label="Users" used={sub.usage.users.used} limit={sub.usage.users.limit} />
            <Meter label="Products" used={sub.usage.products.used} limit={sub.usage.products.limit} />
            <Meter label="Registers" used={sub.usage.registers.used} limit={sub.usage.registers.limit} />
            <Meter label="Branches" used={sub.usage.branches.used} limit={sub.usage.branches.limit} />
            <li style={{ fontVariantNumeric: "tabular-nums" }}>Sales this month: {sub.usage.salesMonthly}</li>
          </ul>
        </section>
      )}
      <section aria-label="Invoices">
        <h2>Invoices</h2>
        {invoicesQuery.isLoading && <p>Loading invoices…</p>}
        {(invoicesQuery.data?.items.length ?? 0) === 0 && <p>No invoices yet.</p>}
        {(invoicesQuery.data?.items ?? []).map((inv) => (
          <p key={inv.id} style={{ fontVariantNumeric: "tabular-nums" }}>
            {inv.periodStart.slice(0, 10)} → {inv.periodEnd.slice(0, 10)}: {money(inv.amountMinor)} {inv.currency} — {inv.status}
          </p>
        ))}
      </section>
      <section aria-label="API tokens">
        <h2>API tokens</h2>
        {newSecret !== null && (
          <p role="status" style={{ fontVariantNumeric: "tabular-nums" }}>
            New token secret (shown once): {newSecret}
          </p>
        )}
        <ul>
          {(tokensQuery.data?.items ?? []).map((t) => (
            <li key={t.id} style={{ fontVariantNumeric: "tabular-nums" }}>
              {t.name} — {t.prefix} — {t.scopes.join(", ")}
              {t.revokedAt ? " (revoked)" : ""}{" "}
              {manageable && !t.revokedAt && (
                <button onClick={() => void revokeToken(t.id)}>Revoke</button>
              )}
            </li>
          ))}
        </ul>
        {manageable ? (
          <form onSubmit={(e) => void mintToken(e)}>
            <label>
              Token name
              <input value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="Nightly export" />
            </label>
            <fieldset>
              <legend>Scopes</legend>
              {ALL_SCOPES.map((s) => (
                <label key={s}>
                  <input
                    type="checkbox"
                    checked={tokenScopes.includes(s)}
                    onChange={(e) =>
                      setTokenScopes(
                        e.target.checked ? [...tokenScopes, s] : tokenScopes.filter((x) => x !== s),
                      )
                    }
                  />
                  {s}
                </label>
              ))}
            </fieldset>
            <button type="submit">Mint token</button>
          </form>
        ) : (
          <p>Only owners and managers can manage API tokens.</p>
        )}
      </section>
      {error !== "" && <p role="alert">{error}</p>}
    </main>
  );
}
