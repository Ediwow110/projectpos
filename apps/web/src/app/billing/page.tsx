"use client";

import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, StatusPill } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import { errorText } from "../../lib/billing";
import {
  billingOverview,
  invoiceLedger,
  type FetchState,
  type InvoiceWire,
  type SubscriptionWire,
  type UsageMeter,
} from "../../lib/billing-view";

interface Profile {
  role: string;
  businessName?: string;
  permissions?: string[];
}

// Bars are non-text indicators, so they may carry the semantic hues directly.
// `info` never paints a bar (unmetered/excluded rows draw the dashed track),
// but the map stays exhaustive so a new tone cannot fall through silently.
const BAR_FILL: Record<UsageMeter["tone"], string> = {
  ok: "bg-[var(--color-atlas-verified)]",
  warn: "bg-[var(--color-atlas-warning-strong)]",
  bad: "bg-[#c43e3e]",
  info: "bg-[var(--color-atlas-muted-strong)]",
};

function stateOf(query: {
  isPending: boolean;
  isError: boolean;
}): FetchState {
  return query.isPending ? "loading" : query.isError ? "error" : "ready";
}

function UsageMeterRow({ meter }: { meter: UsageMeter }): JSX.Element {
  return (
    <li className="rounded-xl border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface-muted)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--color-atlas-ink)]">{meter.label} usage</span>
        <StatusPill tone={meter.tone}>{meter.stateText}</StatusPill>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-data text-sm text-[var(--color-atlas-ink)]">{meter.valueText}</span>
        {/* An unmetered cap has no percentage to show, so nothing is drawn for it. */}
        <span className="font-data text-xs text-[var(--color-atlas-muted-strong)]">{meter.pctText}</span>
      </div>
      {meter.kind === "metered" ? (
        <div
          role="meter"
          aria-label={`${meter.label} usage`}
          aria-valuemin={0}
          aria-valuemax={meter.limit ?? undefined}
          aria-valuenow={meter.used ?? undefined}
          aria-valuetext={meter.valueText}
          className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-atlas-line)]"
        >
          <div
            aria-hidden
            className={`h-full rounded-full ${BAR_FILL[meter.tone]}`}
            style={{ width: `${meter.pct ?? 0}%` }}
          />
        </div>
      ) : (
        <div aria-hidden className="mt-3 h-2 rounded-full border border-dashed border-[var(--color-atlas-line)]" />
      )}
    </li>
  );
}

export default function BillingPage(): JSX.Element {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Profile>("/api/v1/me"),
    retry: false,
  });
  const subscription = useQuery({
    queryKey: ["billing-subscription"],
    queryFn: () => apiFetch<SubscriptionWire>("/api/v1/billing/subscription"),
    retry: false,
  });
  const invoices = useQuery({
    queryKey: ["billing-invoices"],
    queryFn: () => apiFetch<{ items: InvoiceWire[] }>("/api/v1/billing/invoices"),
    retry: false,
  });

  const subscriptionState = stateOf(subscription);
  const invoicesState = stateOf(invoices);
  // No clock argument: the countdown reads the browser clock, exactly the way
  // every other time-aware surface in this app does.
  const overview = billingOverview(subscriptionState, subscription.data);
  const ledger = invoiceLedger(invoicesState, invoices.data?.items);
  const subscriptionFailed = subscriptionState === "error";
  // A 2xx with no body is not a plan with zero usage, so it gets its own notice
  // instead of the error copy or a silently blank panel.
  const subscriptionHollow = subscriptionState === "ready" && !subscription.data;

  return (
    <AppShell businessName={me.data?.businessName} role={me.data?.role}>
      <main className="mx-auto w-full max-w-none space-y-6 px-4 pb-12 pt-8 sm:px-8 lg:pt-9 xl:px-[38px]">
        <PageHeader
          eyebrow="BILLING / READ-ONLY"
          title="Plan, usage and invoices"
          description="What the server currently records for this business: the active plan, how close each capped resource is to its allowance, and the invoice ledger. Nothing here changes a plan."
        />

        {subscriptionFailed ? (
          <Panel className="border-[#efb9b9] bg-[var(--color-danger-soft)] p-5">
            <p role="alert" className="text-sm font-semibold text-[#c43e3e]">
              Plan and usage could not be loaded.
            </p>
            <p className="mt-2 text-sm text-[var(--color-atlas-muted-strong)]">
              {errorText(subscription.error, "Check the connection and try again.")}
            </p>
            <GhostButton type="button" className="mt-4" onClick={() => void subscription.refetch()}>
              Retry
            </GhostButton>
          </Panel>
        ) : null}

        {subscriptionHollow ? (
          <Panel className="border-[#f1d6ad] bg-[var(--color-warning-soft)] p-5">
            <p role="alert" className="text-sm font-semibold text-[var(--color-atlas-warning-strong)]">
              The plan request answered, but returned no subscription record.
            </p>
            <GhostButton type="button" className="mt-4" onClick={() => void subscription.refetch()}>
              Retry
            </GhostButton>
          </Panel>
        ) : null}

        {subscriptionState === "loading" ? (
          <Panel className="p-6 text-sm text-[var(--color-atlas-muted-strong)]">
            <p role="status">Loading plan, usage and limits…</p>
          </Panel>
        ) : (
          <>
            <section aria-label="Current plan" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="CURRENT PLAN"
                value={overview.planName}
                icon="◆"
                meta={overview.statusLabel ? `Status ${overview.statusLabel}` : "Status unavailable"}
              />
              <MetricCard
                label="TRIAL"
                value={overview.trial ? overview.trial.daysLeft ?? "—" : "No trial on file"}
                icon="◷"
                tone={overview.trial?.tone === "warn" ? "warning" : "info"}
                meta={overview.trial ? overview.trial.text : "The server sent no trial date"}
              />
              <MetricCard label="PERIOD ENDS" value={overview.periodEndText} icon="▦" meta="Server-reported period end" />
              <MetricCard
                label="SALES THIS MONTH"
                value={overview.salesMonthlyText}
                icon="₱"
                tone="success"
                meta="Counted by the API, not a cap"
              />
            </section>

            <Panel className="p-5">
              <SectionHeader
                title="Usage against plan limits"
                description="One row per capped resource. Each row states its own reading: a plan that sets no cap, a resource the plan does not include, or a value the server did not return."
                action={
                  <GhostButton type="button" onClick={() => void subscription.refetch()}>
                    Refresh
                  </GhostButton>
                }
              />
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {overview.meters.map((meter) => (
                  <UsageMeterRow key={meter.key} meter={meter} />
                ))}
              </ul>
              <p className="mt-4 text-xs leading-5 text-[var(--color-atlas-muted-strong)]">
                Limits are enforced by the server on every gated write; this screen only reports them. A row over its
                cap means the stored count already exceeds the allowance the plan grants.
              </p>
            </Panel>
          </>
        )}

        <DataTableFrame>
          <div className="px-5 py-4">
            <SectionHeader
              title="Invoices"
              description="Issued by the billing ledger on period rollover. Read-only history."
              action={
                invoicesState === "ready" ? (
                  <GhostButton type="button" onClick={() => void invoices.refetch()}>
                    Refresh
                  </GhostButton>
                ) : null
              }
            />
          </div>

          {invoicesState === "loading" ? (
            <p role="status" className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">
              Loading invoices…
            </p>
          ) : null}

          {invoicesState === "error" ? (
            <div className="px-5 pb-8">
              <p role="alert" className="text-sm font-semibold text-[#c43e3e]">
                {ledger.statusText}
              </p>
              <p className="mt-2 text-sm text-[var(--color-atlas-muted-strong)]">
                {errorText(invoices.error, "Check the connection and try again.")}
              </p>
              <GhostButton type="button" className="mt-3" onClick={() => void invoices.refetch()}>
                Retry
              </GhostButton>
            </div>
          ) : null}

          {invoicesState === "ready" && ledger.rows.length === 0 ? (
            <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">{ledger.statusText}</p>
          ) : null}

          {ledger.rows.length > 0 ? (
            <>
              <p className="px-5 pb-3 text-xs text-[var(--color-atlas-muted-strong)]">{ledger.statusText}</p>
              <table className="premium-table min-w-[820px] text-left text-[12px]">
                <caption className="sr-only">Invoices issued for this business</caption>
                <thead>
                  <tr>
                    <th className="px-5 pb-3">Invoice</th>
                    <th className="px-5 pb-3">Period</th>
                    <th className="px-5 pb-3">Issued</th>
                    <th className="px-5 pb-3 text-right">Amount</th>
                    <th className="px-5 pb-3">Status</th>
                    <th className="px-5 pb-3">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-5 py-3 font-semibold text-[var(--color-atlas-ink)]">{row.idLabel}</td>
                      <td className="px-5 py-3">{row.periodText}</td>
                      <td className="font-data px-5 py-3">{row.issuedText}</td>
                      <td className="font-data px-5 py-3 text-right">{row.amountText}</td>
                      <td className="px-5 py-3">
                        <StatusPill tone={row.tone}>{row.statusLabel}</StatusPill>
                      </td>
                      <td className="px-5 py-3">{row.paidText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </DataTableFrame>
      </main>
    </AppShell>
  );
}
