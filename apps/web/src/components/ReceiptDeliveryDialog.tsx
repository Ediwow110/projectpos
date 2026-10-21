"use client";

import React, { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Modal } from "./Modal";
import { GhostButton, PrimaryButton, StatusPill } from "./ui";

export interface ReceiptDeliveryRow {
  id: string;
  channel: "email";
  recipient: string;
  status: "PENDING" | "SENT" | "FAILED";
  createdAt: string;
  sentAt: string | null;
  errorCode: string | null;
}

export function ReceiptDeliveryDialog({
  receiptNo,
  customerEmail,
  deliveries,
  busy,
  error,
  success,
  onEmail,
  onShare,
  onClose,
}: {
  receiptNo: string;
  customerEmail: string | null;
  deliveries: ReceiptDeliveryRow[];
  busy: boolean;
  error: string;
  success: string;
  onEmail: (to: string) => void;
  onShare: () => void;
  onClose: () => void;
}): JSX.Element {
  const [email, setEmail] = useState(customerEmail ?? "");
  const [localError, setLocalError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setLocalError("Enter a valid customer email address.");
      return;
    }
    setLocalError("");
    onEmail(value);
  }

  return (
    <Modal
      open
      variant="atlasFlow"
      title="Deliver receipt"
      description={`Send or share receipt ${receiptNo} without changing the completed sale.`}
      onClose={onClose}
      footer={<GhostButton type="button" disabled={busy} onClick={onClose}>Close</GhostButton>}
    >
      <div className="space-y-5">
        <form noValidate onSubmit={submit} className="space-y-3 rounded-xl border border-[#eee4db] bg-white p-4">
          <div>
            <p className="font-display text-[13px] font-semibold text-[#2a241f]">Email receipt</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--color-atlas-muted-strong)]">The customer receives a secure 24-hour receipt link. A deliberate resend creates a new delivery attempt.</p>
          </div>
          <label className="block text-[11px] font-semibold text-[#655b53]">
            Customer email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              className="field mt-1.5"
              placeholder="customer@example.com"
            />
          </label>
          <PrimaryButton type="submit" className="!bg-[#202826] !shadow-none hover:!bg-[#36443c]" disabled={busy}>{busy ? "Sending…" : "Email receipt"}</PrimaryButton>
        </form>

        <div className="rounded-xl border border-[#eee4db] bg-[#fcf8f3] p-4">
          <p className="font-display text-[13px] font-semibold text-[#2a241f]">Secure share link</p>
          <p className="mt-1 text-[10px] leading-4 text-[var(--color-atlas-muted-strong)]">Create a 24-hour public link you can copy into any customer messaging channel you already use.</p>
          <GhostButton type="button" disabled={busy} onClick={onShare} className="mt-3">Create secure share link</GhostButton>
        </div>

        {(localError || error) ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{localError || error}</p> : null}
        {success ? <p role="status" className="rounded-xl bg-[#edf8f1] px-3 py-2.5 text-[12px] font-medium text-[#31744c]">{success}</p> : null}

        <section aria-label="Receipt delivery history" className="space-y-3">
          <div>
            <p className="font-display text-[13px] font-semibold text-[#2a241f]">Delivery history</p>
            <p className="mt-1 text-[10px] text-[var(--color-atlas-muted-strong)]">Email status is persisted server-side. Share links are intentionally not stored in plaintext.</p>
          </div>
          {deliveries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#ddd0c6] px-4 py-5 text-center text-[11px] text-[var(--color-atlas-muted-strong)]">No email deliveries yet.</p>
          ) : (
            <div className="space-y-2">
              {[...deliveries].reverse().map((delivery) => (
                <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eee4db] bg-white px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-[#2a241f]">{delivery.recipient}</p>
                    <p className="font-data mt-1 text-[9px] text-[var(--color-atlas-muted-strong)]">{new Date(delivery.sentAt ?? delivery.createdAt).toLocaleString()}</p>
                  </div>
                  <StatusPill tone={delivery.status === "SENT" ? "ok" : delivery.status === "FAILED" ? "warn" : "info"}>{delivery.status}</StatusPill>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
