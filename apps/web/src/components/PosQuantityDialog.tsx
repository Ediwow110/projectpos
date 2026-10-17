import { useState, type FormEvent } from "react";
import type { PosProduct } from "../lib/pos-sale-model";
import { minorToMajorFixed } from "../lib/money";

interface PosQuantityDialogProps {
  product: PosProduct;
  onAdd: (quantity: number) => void;
  onClose: () => void;
}

export function PosQuantityDialog({ product, onAdd, onClose }: PosQuantityDialogProps) {
  const [pieces, setPieces] = useState("1");
  const quantity = Number(pieces);
  const valid = /^\d+$/.test(pieces) && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 999;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (valid) onAdd(quantity);
  }

  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-black/70 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="pos-quantity-title"
        className="w-full max-w-[410px] rounded-[18px] border border-[#514a40] bg-[#211f1d] p-6 text-white shadow-[0_24px_70px_-15px_rgb(0_0_0/0.65)]">
        <p className="font-data text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ffb7a4]">Add to current sale</p>
        <h2 id="pos-quantity-title" className="font-display mt-2 text-xl font-semibold">Set quantity for {product.name}</h2>
        <p className="money mt-2 text-[12px] text-white/65">₱{minorToMajorFixed(product.priceMinor)} per piece</p>
        <form onSubmit={submit} className="mt-6">
          <label htmlFor="pos-quantity-pieces" className="block text-[12px] font-semibold text-white/75">Pieces</label>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" aria-label="Decrease pieces" disabled={!valid || quantity === 1}
              onClick={() => setPieces(String(quantity - 1))}
              className="grid h-12 w-12 place-items-center rounded-lg border border-white/15 bg-white/[0.06] text-xl disabled:opacity-35">−</button>
            <input id="pos-quantity-pieces" aria-label="Pieces" type="number" min={1} max={999} step={1}
              autoFocus value={pieces} aria-invalid={!valid}
              onChange={(event) => setPieces(event.target.value)}
              className="field-dark !h-12 min-w-0 flex-1 text-center text-lg font-bold" />
            <button type="button" aria-label="Increase pieces" disabled={!valid || quantity === 999}
              onClick={() => setPieces(String(quantity + 1))}
              className="grid h-12 w-12 place-items-center rounded-lg border border-white/15 bg-white/[0.06] text-xl disabled:opacity-35">+</button>
          </div>
          {!valid ? <p role="alert" className="mt-2 text-xs text-[#ff9a82]">Enter a whole number from 1 to 999.</p> : null}
          <div className="mt-5 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <span className="text-[12px] text-white/65">Line total</span>
            <strong className="money text-xl text-white">₱{minorToMajorFixed(valid ? product.priceMinor * quantity : 0)}</strong>
          </div>
          <div className="mt-6 flex gap-3">
            <button type="button" onClick={onClose}
              className="min-h-12 flex-1 rounded-lg border border-white/15 text-sm font-semibold text-white/80 hover:bg-white/10">Cancel</button>
            <button type="submit" disabled={!valid}
              className="min-h-12 flex-[1.4] rounded-lg bg-[#f35d3f] text-sm font-semibold text-white hover:bg-[#d94a30] disabled:opacity-35">
              {valid ? `Add ${quantity} piece${quantity === 1 ? "" : "s"}` : "Enter quantity"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
