"use client";

import type { JSX } from "react";
import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "../../../components/AppShell";
import { NexposLogo } from "../../../components/brand/NexposLogo";
import { ReceiptItemLines } from "../../../components/ReceiptItemLines";
import { ReceiptDeliveryDialog, type ReceiptDeliveryRow } from "../../../components/ReceiptDeliveryDialog";
import { ReceiptPrinterDialog, type ReceiptPrinterOption } from "../../../components/ReceiptPrinterDialog";
import { PageHeader, Panel } from "../../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../../components/ui";
import { ApiError, apiFetch } from "../../../lib/api";
import { formatMoneyMinor } from "../../../lib/money";

interface Me {
  role: string;
  businessName?: string;
}

interface ReceiptItem {
  name: string;
  qty: number;
  priceMinor: number;
  lineTotalMinor: number;
}

interface ReceiptGiftCardLoad {
  amountMinor: number;
  kind: "NEW" | "RELOAD";
  maskedCode: string | null;
}

interface ReceiptPayment {
  method: string;
  amountMinor: number;
  status: string;
}

interface Receipt {
  receiptNo: string;
  saleId: string;
  branchId: string | null;
  currency: string;
  status: string;
  customerName: string | null;
  customerEmail: string | null;
  items: ReceiptItem[];
  giftCardLoads: ReceiptGiftCardLoad[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  payments: ReceiptPayment[];
}

function money(minor: number): string {
  return formatMoneyMinor(minor);
}

function methodLabel(method: string): string {
  if (method === "qrph") return "QR Ph";
  if (method === "gcash") return "GCash";
  return method.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function ReceiptPage({ params }: { params: Promise<{ saleId: string }> }): JSX.Element {
  const { saleId } = use(params);
  const [showDelivery, setShowDelivery] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");
  const [deliverySuccess, setDeliverySuccess] = useState("");
  const [showPrinter, setShowPrinter] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [printError, setPrintError] = useState("");
  const [printSuccess, setPrintSuccess] = useState("");
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const receiptQuery = useQuery({ queryKey: ["receipt", saleId], queryFn: () => apiFetch<Receipt>(`/api/v1/receipts/${saleId}`), retry: false });
  const deliveriesQuery = useQuery({
    queryKey: ["receipt-deliveries", saleId],
    queryFn: () => apiFetch<{ items: ReceiptDeliveryRow[] }>(`/api/v1/receipts/${saleId}/deliveries`),
    retry: false,
    enabled: Boolean(receiptQuery.data),
  });
  const printersQuery = useQuery({
    queryKey: ["receipt-printers"],
    queryFn: () => apiFetch<{ items: ReceiptPrinterOption[] }>("/api/v1/printers"),
    retry: false,
    enabled: Boolean(receiptQuery.data),
  });
  const branchesQuery = useQuery({
    queryKey: ["receipt-branches"],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; isActive: boolean }> }>("/api/v1/branches"),
    retry: false,
    enabled: Boolean(receiptQuery.data),
  });

  async function sendEmail(to: string): Promise<void> {
    if (deliveryBusy) return;
    setDeliveryBusy(true);
    setDeliveryError("");
    setDeliverySuccess("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch(`/api/v1/receipts/${saleId}/email`, {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          headers: { "Idempotency-Key": `receipt-email-${crypto.randomUUID()}` },
          body: JSON.stringify({ to }),
        },
      });
      setDeliverySuccess(`Receipt emailed to ${to}.`);
      await deliveriesQuery.refetch();
    } catch (err) {
      setDeliveryError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Could not email receipt.");
      await deliveriesQuery.refetch();
    } finally {
      setDeliveryBusy(false);
    }
  }

  async function createShareLink(): Promise<void> {
    if (deliveryBusy) return;
    setDeliveryBusy(true);
    setDeliveryError("");
    setDeliverySuccess("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const share = await apiFetch<{ token: string; expiresAt: string }>(`/api/v1/receipts/${saleId}/share`, {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: "{}" },
      });
      const url = `${window.location.origin}/receipts/shared/${encodeURIComponent(share.token)}`;
      await navigator.clipboard.writeText(url);
      setDeliverySuccess("Secure receipt link copied. It expires in 24 hours.");
    } catch (err) {
      setDeliveryError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Could not create receipt share link.");
    } finally {
      setDeliveryBusy(false);
    }
  }

  async function queueReceiptPrint(printerId: string): Promise<void> {
    if (!receipt || printBusy) return;
    setPrintBusy(true);
    setPrintError("");
    setPrintSuccess("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/print-jobs", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({ printerId, receiptNo: receipt.receiptNo }),
        },
      });
      const printer = (printersQuery.data?.items ?? []).find((item) => item.id === printerId);
      setShowPrinter(false);
      setPrintSuccess(`Receipt queued to ${printer?.name ?? "printer"}. Sent status later means the printer agent claimed it.`);
    } catch (err) {
      setPrintError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Could not queue receipt print.");
    } finally {
      setPrintBusy(false);
    }
  }

  if (receiptQuery.isError || (!receiptQuery.isLoading && !receiptQuery.data)) {
    return (
      <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
        <main className="mx-auto max-w-[1240px] p-6">
          <Panel className="border-[#efb9b9] bg-[#fff0f0] p-6">
            <p role="alert" className="text-sm font-medium text-[#c43e3e]">{receiptQuery.error instanceof ApiError ? `${receiptQuery.error.code}: ${receiptQuery.error.message}` : "Receipt not found."}</p>
            <Link href="/sales" className="mt-3 inline-block text-sm font-semibold text-[#e44e34]">← Back to sales</Link>
          </Panel>
        </main>
      </AppShell>
    );
  }

  const receipt = receiptQuery.data;

  return (
    <AppShell businessName={meQuery.data?.businessName} role={meQuery.data?.role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <div className="print:hidden">
          <PageHeader
            eyebrow="Sales / Receipt"
            title={receipt ? `Receipt ${receipt.receiptNo}` : "Receipt"}
            description="Print the recorded receipt without changing the underlying sale."
            actions={
              <>
                <Link href={`/sales/${saleId}`} className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]">← Sale detail</Link>
                <GhostButton type="button" onClick={() => { setDeliveryError(""); setDeliverySuccess(""); setShowDelivery(true); }}>Deliver receipt</GhostButton>
                <GhostButton type="button" onClick={() => { setPrintError(""); setShowPrinter(true); }}>Print to device</GhostButton>
                <PrimaryButton type="button" onClick={() => window.print()}>Browser print</PrimaryButton>
              </>
            }
          />
        </div>

        {printSuccess ? <p role="status" className="print:hidden rounded-xl bg-[#edf8f1] px-4 py-3 text-[12px] font-medium text-[#31744c]">{printSuccess}</p> : null}

        {receipt ? (
          <article data-ui="printable-receipt" aria-label="Receipt" className="mx-auto w-full max-w-[690px] overflow-hidden rounded-[14px] border border-[#e4e9e3] bg-white shadow-[0_18px_48px_-20px_rgb(22_18_14/0.12)] print:max-w-[80mm] print:rounded-none print:border-0 print:shadow-none">
            <header className="border-b border-dashed border-[#d8ccc2] px-6 py-6 text-center">
              <NexposLogo variant="light" size="md" className="mx-auto" />
              <p className="font-data mt-1 text-[8px] uppercase tracking-[0.16em] text-[#9a8d83]">Retail operations receipt</p>
              <p className="font-data mt-4 text-sm font-semibold text-[#2a241f]">{receipt.receiptNo}</p>
              <div className="mt-3"><StatusPill tone={receipt.status === "COMPLETED" ? "ok" : "info"}>{receipt.status}</StatusPill></div>
              {receipt.customerName ? <p className="mt-3 text-[11px] text-[#73685f]">Customer · {receipt.customerName}</p> : null}
            </header>

            <div className="px-6 py-5">
              <div className="space-y-3">
                <ReceiptItemLines items={receipt.items} />
                {receipt.giftCardLoads.map((load, index) => (
                  <div key={`gift-card-load-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 text-[12px]">
                    <div><p className="font-semibold text-[#2a241f]">{load.kind === "NEW" ? "Gift card load" : "Gift card reload"}</p><p className="font-data mt-1 text-[10px] text-[#9a8d83]">{load.maskedCode ?? "Stored-value load"}</p></div>
                    <p className="font-data font-semibold text-[#2a241f]">₱{money(load.amountMinor)}</p>
                  </div>
                ))}
              </div>

              <div aria-hidden className="my-5 border-t border-dashed border-[#d8ccc2]" />

              <dl className="space-y-2 text-[11px]">
                {[
                  ["Subtotal", receipt.subtotalMinor],
                  ["Discount", -receipt.discountMinor],
                  ["Tax", receipt.taxMinor],
                ].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between"><dt className="text-[#73685f]">{label}</dt><dd className="font-data text-[#2a241f]">{Number(value) < 0 ? "−" : ""}₱{money(Math.abs(Number(value)))}</dd></div>)}
                <div className="flex items-center justify-between border-t border-[#eee4db] pt-3 text-sm"><dt className="font-display font-bold text-[#17130f]">Total</dt><dd className="font-data font-bold text-[#17130f]">₱{money(receipt.totalMinor)}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-[#73685f]">Paid</dt><dd className="font-data text-[#2a241f]">₱{money(receipt.paidMinor)}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-[#73685f]">Change</dt><dd className="font-data text-[#2a241f]">₱{money(receipt.changeMinor)}</dd></div>
              </dl>

              <div aria-hidden className="my-5 border-t border-dashed border-[#d8ccc2]" />

              <div className="space-y-2">
                <p className="font-data text-[8px] font-semibold uppercase tracking-[0.14em] text-[#9a8d83]">Payments</p>
                {receipt.payments.map((payment, index) => <div key={`${payment.method}-${index}`} className="flex items-center justify-between text-[11px]"><span className="text-[#73685f]">{methodLabel(payment.method)} · {payment.status}</span><span className="font-data font-semibold text-[#2a241f]">₱{money(payment.amountMinor)}</span></div>)}
              </div>
            </div>

            <footer className="border-t border-dashed border-[#d8ccc2] px-6 py-5 text-center"><p className="text-[10px] font-semibold text-[#2a241f]">Thank you.</p><p className="font-data mt-2 text-[8px] text-[#9a8d83]">Sale {receipt.saleId.slice(0, 8)} · {receipt.currency}</p></footer>
          </article>
        ) : <Panel className="p-6 text-sm text-[#73685f]">Loading receipt…</Panel>}

        {showDelivery && receipt ? (
          <ReceiptDeliveryDialog
            receiptNo={receipt.receiptNo}
            customerEmail={receipt.customerEmail}
            deliveries={deliveriesQuery.data?.items ?? []}
            busy={deliveryBusy}
            error={deliveryError}
            success={deliverySuccess}
            onEmail={(to) => void sendEmail(to)}
            onShare={() => void createShareLink()}
            onClose={() => setShowDelivery(false)}
          />
        ) : null}

        {showPrinter && receipt ? (
          <ReceiptPrinterDialog
            receiptNo={receipt.receiptNo}
            receiptBranchId={receipt.branchId}
            printers={printersQuery.data?.items ?? []}
            branches={(branchesQuery.data?.items ?? []).filter((branch) => branch.isActive)}
            busy={printBusy}
            error={printError}
            onQueue={(printerId) => void queueReceiptPrint(printerId)}
            onClose={() => setShowPrinter(false)}
          />
        ) : null}
      </main>
      <style>{`@media print { [data-ui="shell-header"], [data-ui="shell-mobile-nav"], [data-ui="shell-sidebar"], [data-ui="shell-footer"] { display: none !important; } [data-ui="shell-body"] { display: block !important; max-width: none !important; } [data-ui="shell-main"] { width: 100% !important; } body { background: #fff !important; } main { padding: 0 !important; } }`}</style>
    </AppShell>
  );
}
