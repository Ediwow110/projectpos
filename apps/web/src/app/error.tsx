"use client";

import type { JSX } from "react";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center bg-[#fcf8f3] p-6 text-[#17130f]">
      <section className="w-full max-w-md rounded-2xl border border-[#eadfd6] bg-white p-7 text-center shadow-[0_18px_45px_-32px_rgb(40_24_16/0.45)]">
        <div className="font-display mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[#fff0ea] font-bold text-[var(--color-atlas-accent-strong)]">!</div>
        <h1 className="font-display mt-4 text-xl font-bold">This page hit an unexpected error</h1>
        <p className="mt-2 text-sm text-[#73685f]">Your session is still intact. Retry the page before refreshing the whole app.</p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex min-h-10 items-center justify-center rounded-[10px] bg-[#f35d3f] px-4 text-sm font-semibold text-white hover:bg-[#d94a30]"
        >
          Retry page
        </button>
      </section>
    </main>
  );
}
