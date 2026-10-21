import type { JSX } from "react";

import { AtlasEntryBrand } from "./AtlasEntryBrand";

/** Shared Figma V4 identity panel for sign-in and owner registration. */
export function AtlasAuthBrandPanel(): JSX.Element {
  return (
    <section
      aria-label="NexPOS introduction"
      data-ui="atlas-v4-auth-identity"
      className="relative flex flex-col overflow-hidden border-b border-[#e4e9e3] bg-[#fff0eb] px-6 py-5 text-[#202826] sm:px-10 sm:py-7 lg:min-h-screen lg:border-b-0 lg:px-[60px] lg:py-[53px]"
    >
      <AtlasEntryBrand compact />
      <div className="animate-auth-copy mt-5 max-w-[410px] sm:mt-10 lg:mt-[128px]">
        <h1 className="font-display text-[28px] font-semibold leading-[1.2] tracking-[-0.035em] sm:text-[38px] lg:text-[47px]">
          Retail,
          <span className="block">under control.</span>
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--color-atlas-muted-strong)] sm:mt-7 sm:text-[18px] lg:ml-1 lg:mt-[83px]">
          Security and simplicity for every shift.
        </p>
      </div>
      <div className="mt-12 hidden min-h-[145px] max-w-[411px] items-center rounded-[14px] bg-[#fbe2d7] px-6 py-6 lg:absolute lg:bottom-[135px] lg:left-[61px] lg:right-[60px] lg:mt-0 lg:flex">
        <p className="max-w-[285px] font-display text-[17px] font-semibold leading-6">
          Your business. Your team. Your customers.
        </p>
      </div>
      <p className="sr-only">No private business metrics or customer details are shown before sign-in.</p>
    </section>
  );
}
