"use client";

import { useState } from "react";
import type { JSX } from "react";

import { DISPLAY_TOKEN_MINUTES } from "../lib/display-token";

export interface DisplayTicket {
  registerId: string;
  registerName: string;
  link: string;
  expiresAt: string;
}

export function DisplayLinkCard({ ticket }: { ticket: DisplayTicket | null }): JSX.Element | null {
  const [copyFailed, setCopyFailed] = useState(false);
  if (!ticket) return null;

  const expiresAt = new Date(ticket.expiresAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });

  async function copyLink(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[#2a241f]">Customer display for {ticket.registerName}</p>
      <p className="text-[11px] leading-5 text-[var(--color-atlas-muted-strong)]">
        Open this link on the display screen. The pairing token is shown once and stops working after{" "}
        {DISPLAY_TOKEN_MINUTES} minutes; pair again from this register to get a new one.
      </p>
      <input
        data-ui="display-link"
        readOnly
        value={ticket.link}
        onFocus={(event) => event.currentTarget.select()}
        className="w-full rounded-xl border border-[#e4d9d0] bg-[#fcf8f3] px-3 py-2 font-data text-[12px] text-[#2a241f]"
      />
      <p className="font-data text-[11px] text-[var(--color-atlas-muted-strong)]">Expires at {expiresAt}</p>
      {copyFailed ? (
        <p role="alert" className="text-[11px] font-medium text-[var(--color-atlas-warning-strong)]">
          This browser blocked the clipboard. Select the link and copy it manually.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <a
          href={ticket.link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-xl bg-[#2a241f] px-4 text-sm font-semibold text-white"
        >
          Open display
        </a>
        <button
          type="button"
          onClick={() => void copyLink(ticket.link)}
          className="min-h-11 rounded-xl border border-[#e4d9d0] bg-white px-4 text-sm font-semibold text-[#2a241f] hover:border-[#f35d3f]"
        >
          Copy link
        </button>
      </div>
    </div>
  );
}
