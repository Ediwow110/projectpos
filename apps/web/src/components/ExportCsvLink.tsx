import type { JSX } from "react";

export function ExportCsvLink({
  href,
  label,
  bounds,
}: {
  href: string;
  label: string;
  bounds: string;
}): JSX.Element {
  return (
    <span className="inline-flex flex-col gap-1">
      <a
        data-ui="export-csv"
        href={href}
        download
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2a241f] px-4 text-sm font-semibold text-white hover:bg-[var(--color-atlas-accent-strong,#a8452f)]"
      >
        {label}
      </a>
      <span className="text-[11px] text-[var(--color-atlas-muted-strong)]">{bounds}</span>
    </span>
  );
}
