import Link from "next/link";
import { AtlasPlatformShell } from "../../../components/AtlasPlatformShell";

const requestTerms = [
  { label: "Tenant", detail: "Exactly one business selected by its owner" },
  { label: "Purpose", detail: "Owner records an explicit reason (10–200 characters)" },
  { label: "Scope", detail: "Read-only, aggregate support diagnostics" },
  { label: "Duration", detail: "1–60 minutes · automatically expires" },
  { label: "Audit", detail: "Issuance, diagnostic reads, and revocation recorded" },
] as const;

export default function PlatformSupportAccessPage() {
  return <AtlasPlatformShell current="support" title="Time-limited support access" description="An independent platform operator must obtain consent from the retail business owner before inspecting that business's diagnostics.">
    <section aria-label="Owner-consented support access" className="max-w-5xl rounded-[14px] border border-[#e5e9e3] bg-white p-5 sm:p-7">
      <span className="inline-block rounded-md bg-[#fcf1df] px-3 py-2 font-data text-[11px] font-semibold text-[#9a6e32]">OWNER CONSENT REQUIRED</span>
      <h2 className="mt-5 font-display text-[23px] font-semibold text-[#202826]">Request access to a single tenant</h2>
      <p className="mt-2 text-sm text-[#748078]">An operator cannot issue owner consent. The business owner must authorize diagnostics through their own signed-in support controls, with their password. There is no platform-initiated consent request endpoint.</p>
      <dl className="mt-6 space-y-2">{requestTerms.map((term, i) => <div key={term.label} className={"grid gap-2 rounded-lg px-4 py-4 text-[13px] sm:grid-cols-[200px_minmax(0,1fr)] " + (i % 2 === 0 ? "bg-[#f7f8f5]" : "bg-white")}>
        <dt className="text-[#748078]">{term.label}</dt>
        <dd className="font-medium text-[#202826]">{term.detail}</dd>
      </div>)}</dl>
      <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
        <Link href="/platform/tenant-health" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#dce3dc] px-5 text-[13px] font-semibold text-[#202826] hover:bg-[#f7f8f5]">Back to tenant health</Link>
        <Link href="/admin/support" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#29332d] px-5 text-[13px] font-semibold text-white hover:bg-[#35423d]">Owner consent controls</Link>
      </div>
      <p className="mt-4 text-right text-xs text-[#748078]">Owner sign-in required. Consent tokens are issued once and must be transferred through a secure channel.</p>
    </section>
  </AtlasPlatformShell>;
}
