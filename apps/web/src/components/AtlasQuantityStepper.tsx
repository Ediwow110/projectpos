import React, { type JSX } from "react";

export function clampAffectedQuantity(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  return Math.min(limit, Math.max(0, Math.floor(value)));
}

export function AtlasQuantityStepper({
  itemName, value, max, onChange,
}: {
  itemName: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}): JSX.Element {
  const limit = clampAffectedQuantity(max, max);
  const quantity = clampAffectedQuantity(value, limit);
  const shared = "grid min-h-11 min-w-11 place-items-center rounded-md text-[20px] font-semibold leading-none text-[#202826] transition-colors hover:bg-[#edf3ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267552] disabled:cursor-not-allowed disabled:text-[#a5afa8] disabled:hover:bg-transparent";

  return <div aria-label={`Quantity affected for ${itemName}`} className="w-full max-w-[216px]">
    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--color-atlas-muted-strong)]">Quantity affected</p>
    <div role="group" aria-label={`Adjust affected quantity for ${itemName}`} className="grid grid-cols-[44px_minmax(32px,1fr)_44px] items-center rounded-lg border border-[#dce3dc] bg-white p-1">
      <button type="button" aria-label={`Decrease affected quantity for ${itemName}`} disabled={quantity === 0} className={shared} onClick={() => onChange(clampAffectedQuantity(quantity - 1, limit))}>−</button>
      <output aria-label={`Affected quantity for ${itemName}`} className="min-w-0 text-center font-data text-[15px] font-semibold tabular-nums text-[#202826]">{quantity}</output>
      <button type="button" aria-label={`Increase affected quantity for ${itemName}`} disabled={quantity >= limit} className={shared} onClick={() => onChange(clampAffectedQuantity(quantity + 1, limit))}>+</button>
    </div>
    <p className="mt-1 text-[11px] text-[var(--color-atlas-muted-strong)]">{`Up to ${limit} purchased`}</p>
  </div>;
}
