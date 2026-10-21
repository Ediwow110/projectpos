"use client";

import { useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";

import { ExportCsvLink } from "../../../components/ExportCsvLink";
import { Panel, SectionHeader } from "../../../components/premium";
import { ReportPageFrame } from "../../../components/ReportPageFrame";
import { apiFetch } from "../../../lib/api";
import { canExport, LEDGER_ROW_WINDOW, ledgerDownloadUrl } from "../../../lib/exports";

interface Me {
  role: string;
  permissions?: string[];
}

export default function LedgerReportPage(): JSX.Element {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const allowed = canExport(meQuery.data?.permissions ?? []);
  const bounds = `Up to ${LEDGER_ROW_WINDOW.toLocaleString("en-US")} rows per export, oldest first. Exports are rate-limited per business.`;

  return (
    <ReportPageFrame
      title="Accounting ledger export"
      description="Download the journal behind the cash, sales and inventory reports as CSV."
    >
      <Panel className="p-5">
        <SectionHeader
          title="Date range"
          description="Leave a bound empty to take journal rows up to right now. Rows carry debit and credit in minor units."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[180px_180px_minmax(0,1fr)]">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">From</span>
            <input
              data-ui="ledger-export-from"
              type="date"
              className="mt-1 min-h-11 w-full rounded-xl border border-[#e4d9d0] bg-white px-3 font-data text-sm"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-atlas-muted-strong)]">To</span>
            <input
              data-ui="ledger-export-to"
              type="date"
              className="mt-1 min-h-11 w-full rounded-xl border border-[#e4d9d0] bg-white px-3 font-data text-sm"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
        </div>
        {allowed ? (
          <div className="mt-4">
            <ExportCsvLink href={ledgerDownloadUrl({ dateFrom, dateTo })} label="Download ledger CSV" bounds={bounds} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--color-atlas-muted-strong)]">
            This download needs the export permission. Ask an owner to grant it if you need ledger extracts.
          </p>
        )}
      </Panel>
    </ReportPageFrame>
  );
}
