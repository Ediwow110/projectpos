import React from "react";

interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
}

interface PosCustomerDialogProps {
  customerQuery: string;
  customerId: string;
  walkIn: string;
  customers: CustomerOption[];
  onCustomerQueryChange: (query: string) => void;
  onSelectCustomer: (customer: CustomerOption) => void;
  onWalkInChange: (walkIn: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function PosCustomerDialog({
  customerQuery,
  customerId,
  walkIn,
  customers,
  onCustomerQueryChange,
  onSelectCustomer,
  onWalkInChange,
  onClear,
  onClose,
}: PosCustomerDialogProps) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label="Customer assignment">
      <div className="w-full max-w-lg rounded-[18px] border border-white/10 bg-[#171614] p-5 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-data text-[8px] uppercase tracking-[0.14em] text-[#ff765a]">Current sale</p>
            <h2 className="font-display mt-2 text-xl font-semibold">Assign customer</h2>
            <p className="mt-1 text-[11px] text-white/45">Choose an existing customer or keep a walk-in name for this sale.</p>
          </div>
          <button
            type="button"
            aria-label="Close customer assignment"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-white/60 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="relative block text-[10px] font-semibold uppercase tracking-[0.08em] text-white/45">
            Customer
            <input
              value={customerQuery}
              onChange={(event) => onCustomerQueryChange(event.target.value)}
              placeholder="Search customers"
              className="field-dark mt-2 normal-case tracking-normal"
            />
            {customerQuery.trim() !== "" ? (
              <ul className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-xl border border-white/10 bg-[#252422] p-1 shadow-xl">
                {customers.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      onClick={() => onSelectCustomer(customer)}
                      className="w-full rounded-lg px-3 py-2 text-left text-[12px] normal-case hover:bg-white/10"
                    >
                      <span className="font-semibold">{customer.name}</span>
                      {customer.phone ? <span className="text-white/45"> — {customer.phone}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </label>

          <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-white/45">
            Walk-in name
            <input
              value={walkIn}
              onChange={(event) => onWalkInChange(event.target.value)}
              placeholder="Optional"
              className="field-dark mt-2 normal-case tracking-normal"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <p className="text-[11px] text-white/45">
            {customerId !== "" ? `Selected: ${customerQuery}` : walkIn.trim() !== "" ? `Walk-in: ${walkIn.trim()}` : "No customer assigned"}
          </p>
          <div className="flex gap-2">
            {(customerId !== "" || walkIn.trim() !== "") ? (
              <button
                type="button"
                onClick={onClear}
                className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/60 hover:text-white"
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#f35d3f] px-5 py-2 text-[11px] font-semibold text-white hover:bg-[#d94a30]"
            >
              Use for sale
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
