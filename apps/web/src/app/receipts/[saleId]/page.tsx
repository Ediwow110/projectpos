"use client";

import type { JSX } from "react";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../lib/api";

interface ReceiptItem {
  name: string;
  qty: number;
  priceMinor: number;
  lineTotalMinor: number;
}

interface ReceiptPayment {
  method: string;
  amountMinor: number;
  status: string;
}

interface Receipt {
  receiptNo: string;
  saleId: string;
  currency: string;
  status: string;
  customerName: string | null;
  items: ReceiptItem[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  payments: ReceiptPayment[];
}

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export default function ReceiptPage({ params }: { params: Promise<{ saleId: string }> }): JSX.Element {
  const { saleId } = use(params);
  const receiptQuery = useQuery({
    queryKey: ["receipt", saleId],
    queryFn: () => apiFetch<Receipt>("/api/v1/receipts/" + saleId),
    retry: false,
  });

  if (receiptQuery.isLoading) return <main>Loading receipt…</main>;
  if (receiptQuery.isError)
    return (
      <main>
        <p role="alert">
          {receiptQuery.error instanceof ApiError
            ? receiptQuery.error.code + ": " + receiptQuery.error.message
            : "Receipt not found."}
        </p>
        <Link href="/pos">Back to POS</Link>
      </main>
    );
  if (!receiptQuery.data)
    return (
      <main>
        <p role="alert">Receipt not found.</p>
        <Link href="/pos">Back to POS</Link>
      </main>
    );

  const r = receiptQuery.data;
  return (
    <main>
      <Link href="/pos">Back to POS</Link>
      <article
        aria-label="Receipt"
        style={{
          fontFamily: "ui-monospace, monospace",
          maxWidth: "320px",
          border: "1px solid #ccc",
          padding: "1rem",
        }}
      >
        <h1>Receipt {r.receiptNo}</h1>
        <p>Status: {r.status}</p>
        {r.customerName && <p>Customer: {r.customerName}</p>}
        <hr />
        <ul style={{ listStyle: "none", padding: 0 }}>
          {r.items.map((i, idx) => (
            <li key={idx} style={{ fontVariantNumeric: "tabular-nums" }}>
              {i.name} × {i.qty} — {money(i.lineTotalMinor)}
            </li>
          ))}
        </ul>
        <div
          aria-hidden="true"
          style={{ borderTop: "2px dashed #999", margin: "0.75rem 0" }}
        />
        <dl style={{ fontVariantNumeric: "tabular-nums" }}>
          <div><dt>Subtotal</dt><dd>{money(r.subtotalMinor)}</dd></div>
          <div><dt>Discount</dt><dd>{money(r.discountMinor)}</dd></div>
          <div><dt>Tax</dt><dd>{money(r.taxMinor)}</dd></div>
          <div><dt>Total</dt><dd>{money(r.totalMinor)}</dd></div>
          <div><dt>Paid</dt><dd>{money(r.paidMinor)}</dd></div>
          <div><dt>Change</dt><dd>{money(r.changeMinor)}</dd></div>
        </dl>
        <ul>
          {r.payments.map((p, idx) => (
            <li key={idx}>{p.method}: {money(p.amountMinor)} ({p.status})</li>
          ))}
        </ul>
      </article>
      <button onClick={() => window.print()}>Print receipt</button>
      <style>{`@media print { button, a { display: none; } article { border: none !important; max-width: 80mm !important; } }`}</style>
    </main>
  );
}
