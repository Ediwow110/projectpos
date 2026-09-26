import type { JSX } from "react";

export default function Loading(): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[1240px] animate-pulse space-y-4 px-4 py-5 sm:px-6" aria-label="Loading page">
      <div className="h-7 w-48 rounded-lg bg-[#eee6df]" />
      <div className="h-4 w-80 max-w-full rounded bg-[#f2ebe5]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 rounded-2xl bg-white/80" />)}
      </div>
      <div className="h-72 rounded-2xl bg-white/80" />
    </div>
  );
}
