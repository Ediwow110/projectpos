import type { JSX } from "react";
import Link from "next/link";

/** Atlas V4 brand lockup for public entry and first-run setup surfaces. */
export function AtlasEntryBrand({ compact = false, href = "/login" }: { compact?: boolean; href?: string }): JSX.Element {
  return (
    <Link href={href} aria-label="NexPOS home" className="inline-flex min-h-11 items-center gap-3 text-[#202826] focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#da614c]">
      <span aria-hidden="true" className="grid h-[43px] w-[43px] shrink-0 place-items-center rounded-[11px] bg-[#29332d] font-display text-[23px] font-semibold text-white">N</span>
      <span className="min-w-0">
        <span className="block font-display text-[21px] font-semibold leading-tight tracking-[-0.04em]">NexPOS</span>
        {!compact ? <span className="font-data block text-[9px] uppercase tracking-[0.14em] text-[#748078]">Retail operations</span> : null}
      </span>
    </Link>
  );
}
