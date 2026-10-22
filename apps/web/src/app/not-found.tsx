import type { JSX } from "react";
import Link from "next/link";

/**
 * The app had no not-found surface, so a mistyped or stale address rendered
 * Next.js's default page: a bare "404" with no way back into the workspace.
 * This is the recovery path the audit asks for, in the Atlas entry style the
 * public pages use.
 */
export default function NotFound(): JSX.Element {
  return (
    <main data-ui="atlas-v4-not-found" className="atlas-entry grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-md rounded-2xl border border-[#e5e9e3] bg-white p-7 text-center shadow-[0_18px_45px_-32px_rgb(32_40_38/0.35)]">
        <p className="font-data text-[12px] font-medium uppercase tracking-[0.16em] text-[var(--color-atlas-accent-strong)]">Error 404</p>
        <h1 className="font-display mt-3 text-[26px] font-semibold leading-tight text-[#202826]">That address is not part of the workspace</h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--color-atlas-muted-strong)]">
          The link may be out of date, or the record it pointed at may have been removed. Your
          workspace, its items and its records are unaffected.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-[#29332d] px-4 text-sm font-semibold text-white hover:bg-[#35423d]"
          >
            Back to workspace
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[#dce3dc] bg-white px-4 text-sm font-semibold text-[#202826] hover:bg-[#f0f3ef]"
          >
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
