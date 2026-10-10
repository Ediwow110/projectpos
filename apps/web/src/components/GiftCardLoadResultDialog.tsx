"use client";

import React from "react";

import { formatMoneyMinor } from "../lib/money";
import { Modal } from "./Modal";
import { GhostButton, PrimaryButton } from "./ui";

function money(minor: number): string {
  return formatMoneyMinor(minor);
}

function Code128Preview({ code }: { code: string }): React.JSX.Element {
  const bars = Array.from(code).flatMap((char, index) => {
    const value = char.charCodeAt(0) + index * 17;
    return Array.from({ length: 7 }, (_, bit) => ((value >> bit) & 1) === 1 ? "bg-[#17130f]" : "bg-white");
  });
  return <div role="img" aria-label="Code128 barcode preview" className="flex h-20 items-stretch overflow-hidden rounded border border-[#e4d9d0] bg-white p-2">{bars.map((bar, index) => <span key={`${bar}-${index}`} className={`w-[2px] shrink-0 ${bar}`} />)}</div>;
}

export function GiftCardLoadResultDialog({
  code,
  amountMinor,
  onClose,
}: {
  code: string;
  amountMinor: number;
  onClose: () => void;
}): React.JSX.Element {
  async function copy(): Promise<void> {
    await navigator.clipboard?.writeText(code);
  }

  function print(): void {
    window.print();
  }

  return (
    <Modal
      open
      title="Gift card created"
      description="Treat this bearer code like cash. It will not be shown in full again."
      onClose={onClose}
      footer={<div className="flex flex-wrap justify-end gap-2"><GhostButton type="button" onClick={copy}>Copy code</GhostButton><GhostButton type="button" onClick={print}>Print</GhostButton><PrimaryButton type="button" onClick={onClose}>Done</PrimaryButton></div>}
    >
      <div className="space-y-4">
        <p className="text-sm text-[#655b53]">Loaded: <strong>₱{money(amountMinor)}</strong></p>
        <p className="rounded-lg border border-[#f2c6b8] bg-[#fff0ea] px-3 py-2 text-[11px] font-medium text-[#9f3b2d]">The full bearer code is visible once. Dismiss this window when the customer has received it.</p>
        <code className="block rounded-lg bg-[#171614] px-3 py-3 text-center text-sm font-semibold tracking-[0.12em] text-white">{code}</code>
        <Code128Preview code={code} />
      </div>
    </Modal>
  );
}

