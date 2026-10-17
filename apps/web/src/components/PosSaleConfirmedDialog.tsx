"use client";

import React from "react";
import Link from "next/link";
import { Modal } from "./Modal";
import { minorToMajorFixed } from "../lib/money";

export interface PosConfirmedSale {
  saleId: string;
  receiptNo?: string;
  amountMinor: number;
}

export function PosSaleConfirmedDialog({ sale, onClose }: { sale: PosConfirmedSale; onClose: () => void }) {
  return (
    <Modal
      open
      variant="atlasFlow"
      title="Payment complete"
      description={`₱${minorToMajorFixed(sale.amountMinor)} received. The receipt is ready.`}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Link
            href={`/receipts/${encodeURIComponent(sale.saleId)}`}
            className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-[#dce3dc] bg-white px-5 text-[13px] font-medium text-[#202826] hover:bg-[#eff2ed]"
          >
            View receipt
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-[155px] items-center justify-center rounded-[8px] bg-[#202826] px-5 text-[13px] font-semibold text-white hover:bg-[#36443c]"
          >
            OK
          </button>
        </div>
      }
    >
      <div className="space-y-[14px]" data-ui="atlas-sale-confirmed">
        <p className="rounded-[8px] bg-[#eff2ed] px-4 py-[18px] text-[13px] font-medium text-[#202826]">
          {sale.receiptNo ? `Sale #${sale.receiptNo}` : "Sale recorded"}
        </p>
        <p className="rounded-[8px] bg-[#eff2ed] px-4 py-[18px] text-[13px] text-[#202826]">Payment: confirmed</p>
        <p className="rounded-[8px] bg-[#eff2ed] px-4 py-[18px] text-[13px] text-[#202826]">Receipt: available</p>
        <p className="text-[11px] leading-5 text-[#71807a]">
          This is a POS receipt for the completed sale, not a tax invoice or BIR-compliant document.
        </p>
      </div>
    </Modal>
  );
}
