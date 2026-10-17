"use client";

import type { FormEvent, JSX } from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PrimaryButton } from "../../components/ui";
import { apiFetch } from "../../lib/api";

export interface ReceiptCopySettings {
  receiptHeader: string;
  receiptFooter: string;
}

interface BusinessReceiptContext {
  name: string;
  settings: Record<string, unknown>;
}

export function ReceiptSetupForm({
  saving,
  onConfirm,
}: {
  saving: boolean;
  onConfirm: (customCopy?: ReceiptCopySettings) => void;
}): JSX.Element {
  const business = useQuery({
    queryKey: ["onboarding", "receipt-business"],
    queryFn: () => apiFetch<BusinessReceiptContext>("/api/v1/business"),
    retry: false,
  });
  const [editCopy, setEditCopy] = useState(false);
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    const settings = business.data?.settings;
    if (!settings) return;
    setHeader(typeof settings["receiptHeader"] === "string" ? settings["receiptHeader"] : "");
    setFooter(typeof settings["receiptFooter"] === "string" ? settings["receiptFooter"] : "");
  }, [business.data]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!reviewed || business.isLoading || business.isError) return;
    if (editCopy && !header.trim() && !footer.trim()) {
      setValidationError("Add a receipt header or footer, or turn off optional editing.");
      return;
    }
    setValidationError("");
    onConfirm(editCopy ? { receiptHeader: header.trim(), receiptFooter: footer.trim() } : undefined);
  }

  const savedSettings = business.data?.settings;
  const displayedHeader = editCopy
    ? header
    : typeof savedSettings?.["receiptHeader"] === "string" ? savedSettings["receiptHeader"] : "";
  const displayedFooter = editCopy
    ? footer
    : typeof savedSettings?.["receiptFooter"] === "string" ? savedSettings["receiptFooter"] : "";

  return (
    <form className="mt-6 space-y-5" onSubmit={submit}>
      <p className="text-[11px] leading-5 text-[#73685f]">
        Review what a completed sale will show. Standard receipts include your business name,
        an automatic receipt number, line items and totals. This does not configure a printer.
      </p>
      {business.isLoading ? <p role="status" className="text-xs text-[#73685f]">Loading saved receipt details…</p> : null}
      {business.isError ? (
        <div role="alert" className="text-xs text-[#c43e3e]">
          Could not load saved receipt details.
          <button type="button" className="ml-2 font-semibold underline" onClick={() => void business.refetch()}>Try again</button>
        </div>
      ) : null}

      <div aria-label="Receipt preview" className="rounded-xl border border-[#eee4db] bg-white p-5">
        <h4 className="font-display text-[13px] font-semibold text-[#2a241f]">Receipt preview</h4>
        <div className="mt-4 space-y-2 border-y border-dashed border-[#cfc2b6] py-4 text-center font-data text-[11px] text-[#51483f]">
          <p className="font-semibold">{business.data?.name ?? "Your registered business name"}</p>
          {displayedHeader ? <p className="whitespace-pre-wrap">{displayedHeader}</p> : null}
          <p>Automatic receipt number</p>
          <p>Completed sale items, taxes, totals, paid amount and change</p>
          {displayedFooter ? <p className="whitespace-pre-wrap">{displayedFooter}</p> : null}
        </div>
        <p className="mt-3 text-[10px] leading-4 text-[#73685f]">
          Content summary only — not a printed, fiscal or legal-compliance preview.
        </p>
      </div>

      <label className="flex items-start gap-2 text-[11px] font-medium text-[#2a241f]">
        <input type="checkbox" className="mt-0.5 accent-[#d94a30]" checked={editCopy}
          onChange={(event) => setEditCopy(event.target.checked)} />
        Edit optional receipt header and footer (subject to your plan)
      </label>
      {editCopy ? (
        <div className="space-y-3">
          <p className="text-[10px] leading-4 text-[#73685f]">
            Custom receipt text is a paid feature. If it is unavailable on your plan,
            turn off editing and confirm the existing receipt format instead.
          </p>
          <label className="block space-y-1 text-[11px] font-semibold text-[#2a241f]">
            Header
            <textarea className="field w-full" maxLength={200} rows={2} value={header}
              onChange={(event) => setHeader(event.target.value)} />
          </label>
          <label className="block space-y-1 text-[11px] font-semibold text-[#2a241f]">
            Footer
            <textarea className="field w-full" maxLength={200} rows={2} value={footer}
              onChange={(event) => setFooter(event.target.value)} />
          </label>
        </div>
      ) : null}

      <label className="flex items-start gap-2 text-[11px] font-semibold text-[#2a241f]">
        <input type="checkbox" className="mt-0.5 accent-[#d94a30]" checked={reviewed}
          onChange={(event) => setReviewed(event.target.checked)} />
        I reviewed the receipt details for this business
      </label>
      {validationError ? <p role="alert" className="text-xs text-[#c43e3e]">{validationError}</p> : null}
      <PrimaryButton type="submit" disabled={!reviewed || saving || business.isLoading || business.isError}
        aria-busy={saving}>
        {saving ? "Saving receipt setup…" : "Confirm receipt setup"}
      </PrimaryButton>
    </form>
  );
}
