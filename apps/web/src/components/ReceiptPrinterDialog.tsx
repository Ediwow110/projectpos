"use client";

import React, { useMemo, useState } from "react";
import type { JSX } from "react";

import { Modal } from "./Modal";
import { GhostButton, PrimaryButton, StatusPill } from "./ui";

export interface ReceiptPrinterOption {
  id: string;
  name: string;
  branchId: string | null;
  width: string;
  connection: string;
  lastSeenAt: string | null;
  agentStatus: "online" | "offline" | "never";
  isDefault: boolean;
}

export function chooseReceiptPrinterId(currentId: string, printers: ReceiptPrinterOption[]): string {
  if (currentId && printers.some((printer) => printer.id === currentId)) return currentId;
  return printers.find((printer) => printer.isDefault)?.id ?? printers[0]?.id ?? "";
}

export function ReceiptPrinterDialog({
  receiptNo,
  receiptBranchId,
  printers,
  branches,
  busy,
  error,
  onQueue,
  onClose,
}: {
  receiptNo: string;
  receiptBranchId: string | null;
  printers: ReceiptPrinterOption[];
  branches: Array<{ id: string; name: string }>;
  busy: boolean;
  error: string;
  onQueue: (printerId: string) => void;
  onClose: () => void;
}): JSX.Element {
  const eligiblePrinters = useMemo(
    () => printers.filter((printer) => printer.branchId === null || printer.branchId === receiptBranchId),
    [printers, receiptBranchId],
  );
  const [printerId, setPrinterId] = useState("");
  const effectivePrinterId = useMemo(
    () => chooseReceiptPrinterId(printerId, eligiblePrinters),
    [printerId, eligiblePrinters],
  );
  const selected = useMemo(
    () => eligiblePrinters.find((printer) => printer.id === effectivePrinterId) ?? null,
    [eligiblePrinters, effectivePrinterId],
  );
  const branchName = selected?.branchId ? branches.find((branch) => branch.id === selected.branchId)?.name ?? "Assigned branch" : "All branches / unassigned";

  return (
    <Modal
      open
      title="Print receipt"
      description={`Queue receipt ${receiptNo} to a paired receipt printer.`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <GhostButton type="button" disabled={busy} onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="button" disabled={busy || !selected} onClick={() => selected && onQueue(selected.id)}>
            {busy ? "Queueing…" : "Queue receipt"}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-4">
        {eligiblePrinters.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#ddd0c6] bg-[#fcf8f3] p-5 text-center text-[11px] leading-5 text-[#73685f]">
            No receipt printers are configured. Open Administration → Printers to enroll one.
          </div>
        ) : (
          <>
            <label className="block text-[11px] font-semibold text-[#655b53]">
              Receipt printer
              <select className="field mt-1.5" value={effectivePrinterId} onChange={(event) => setPrinterId(event.target.value)}>
                {eligiblePrinters.map((printer) => (
                  <option key={printer.id} value={printer.id}>{printer.name}{printer.isDefault ? " · Default" : ""}</option>
                ))}
              </select>
            </label>
            {selected ? (
              <div className="rounded-xl border border-[#eee4db] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-[13px] font-semibold text-[#2a241f]">{selected.name}</p>
                    <p className="font-data mt-1 text-[9px] text-[var(--color-atlas-muted-strong)]">{branchName} · {selected.width}mm</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.isDefault ? <StatusPill tone="info">Default</StatusPill> : null}
                    <StatusPill tone={selected.agentStatus === "online" ? "ok" : selected.agentStatus === "offline" ? "warn" : "info"}>
                      {selected.agentStatus === "online" ? "Online" : selected.agentStatus === "offline" ? "Offline" : "Never connected"}
                    </StatusPill>
                  </div>
                </div>
                <p className="mt-3 text-[10px] leading-4 text-[#73685f]">
                  Queueing confirms only that NexPOS accepted the job. “Sent” later means the job was handed to the printer agent; the current agent protocol does not confirm paper output.
                </p>
              </div>
            ) : null}
          </>
        )}
        {error ? <p role="alert" className="rounded-xl bg-[#fff0f0] px-3 py-2.5 text-[12px] font-medium text-[#c43e3e]">{error}</p> : null}
      </div>
    </Modal>
  );
}
