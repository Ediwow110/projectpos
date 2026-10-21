"use client";

import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";

import { MetricCard, Panel } from "../../../components/premium";
import { ReportPageFrame } from "../../../components/ReportPageFrame";
import { ApiError, apiFetch } from "../../../lib/api";
import { formatMoneyMinor } from "../../../lib/money";

interface Me {
  role: string;
  permissions?: string[];
}

interface StoredValuePayload {
  giftCards: { count: number; liabilityMinor: number };
  storeCredit: { liabilityMinor: number };
  loyalty: { outstandingPoints: number };
}

/** The report endpoint guards with this grant, so the page asks for the same one. */
export default function StoredValueReportPage(): JSX.Element {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const allowed = (meQuery.data?.permissions ?? []).includes("stored_value.adjust");
  const reportQuery = useQuery({
    queryKey: ["report-stored-value"],
    queryFn: () => apiFetch<StoredValuePayload>("/api/v1/reports/stored-value"),
    retry: false,
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <ReportPageFrame title="Stored-value liability" description="Outstanding gift-card and store-credit liability plus unredeemed loyalty points.">
        <Panel className="p-6 text-sm text-[var(--color-atlas-muted-strong)]">
          This report needs stored-value review. The server withholds it from roles without that grant.
        </Panel>
      </ReportPageFrame>
    );
  }

  const payload = reportQuery.data;
  const totalLiabilityMinor = (payload?.giftCards.liabilityMinor ?? 0) + (payload?.storeCredit.liabilityMinor ?? 0);
  const nothingOutstanding =
    payload !== undefined && totalLiabilityMinor === 0 && payload.loyalty.outstandingPoints === 0;

  return (
    <ReportPageFrame title="Stored-value liability" description="Outstanding gift-card and store-credit liability plus unredeemed loyalty points.">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Stored-value summary">
        <MetricCard label="Gift-card liability" value={`₱${formatMoneyMinor(payload?.giftCards.liabilityMinor ?? 0)}`} icon="▧" tone="info" meta={`${payload?.giftCards.count ?? 0} cards`} />
        <MetricCard label="Store credit" value={`₱${formatMoneyMinor(payload?.storeCredit.liabilityMinor ?? 0)}`} icon="₱" meta="Across all customers" />
        <MetricCard label="Total liability" value={`₱${formatMoneyMinor(totalLiabilityMinor)}`} icon="∑" tone="warning" meta="Cards plus credit" />
        <MetricCard label="Loyalty points" value={(payload?.loyalty.outstandingPoints ?? 0).toLocaleString("en-PH")} icon="✦" meta="Not yet redeemed" />
      </section>

      {reportQuery.isLoading ? <Panel className="p-6 text-sm text-[#73685f]">Loading stored value…</Panel> : null}
      {reportQuery.isError ? (
        <Panel className="border-[#efb9b9] bg-[#fff0f0] p-5">
          <p role="alert" className="text-sm font-medium text-[#c43e3e]">
            {reportQuery.error instanceof ApiError ? `${reportQuery.error.code}: ${reportQuery.error.message}` : "Could not load the stored-value report."}
          </p>
          <p className="mt-2 text-[12px] text-[var(--color-atlas-muted-strong)]">
            These balances are a real liability: a failure here is not the same as nothing owed.
          </p>
          <button
            type="button"
            onClick={() => void reportQuery.refetch()}
            className="mt-3 min-h-11 rounded-xl border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]"
          >
            Retry
          </button>
        </Panel>
      ) : null}
      {nothingOutstanding ? (
        <Panel className="p-6 text-sm text-[var(--color-atlas-muted-strong)]">No stored value on record.</Panel>
      ) : null}
    </ReportPageFrame>
  );
}
