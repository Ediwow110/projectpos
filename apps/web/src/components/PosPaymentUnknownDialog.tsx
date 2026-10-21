"use client";

import React from "react";
import Link from "next/link";
import { Modal } from "./Modal";

/** Informational recovery only. It never triggers a payment or settlement update. */
export function PosPaymentUnknownDialog({
  saleId,
  onClose,
}: {
  saleId: string;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      variant="atlasFlow"
      hideHeaderClose
      title="Payment not yet confirmed"
      description="Never charge again without checking evidence."
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-lg px-6 text-[13px] font-medium text-[#202826] hover:bg-[#eff2ed]"
          >
            Close
          </button>
          <Link
            href={`/sales/${encodeURIComponent(saleId)}`}
            className="inline-flex min-h-11 min-w-[155px] items-center justify-center rounded-lg bg-[#202826] px-6 text-[13px] font-semibold text-white hover:bg-[#36443c]"
          >
            Check status
          </Link>
        </div>
      }
    >
      <div className="space-y-[14px]" data-ui="atlas-payment-unknown">
        <p className="break-all rounded-[8px] bg-[#eff2ed] px-4 py-[18px] text-[13px] text-[#202826]">
          Sale reference: {saleId}
        </p>
        <p className="rounded-[8px] bg-[#eff2ed] px-4 py-[18px] text-[13px] text-[#202826]">
          Status: UNKNOWN
        </p>
        <p className="rounded-[8px] bg-[#eff2ed] px-4 py-[18px] text-[13px] text-[#202826]">
          Recovery: Check status
        </p>
        <p role="status" className="text-[11px] leading-5 text-[var(--color-atlas-muted-strong)]">
          Ask an owner or manager to compare provider records before settling or retrying this sale. No final receipt is available yet.
        </p>
      </div>
    </Modal>
  );
}
