import Link from "next/link";

type HelpPath = { readonly title: string; readonly body: string; readonly href?: string };

/** Only `href` entries are navigable. The remaining topics are handled inside
 * the verified order status page, so they are shown as guidance, not as links. */
const paths: readonly HelpPath[] = [
  {
    title: "Find an existing order",
    body: "Open the secure order status link sent to your email. It works without creating an account.",
    href: "/order-status",
  },
  {
    title: "Report a problem",
    body: "Missing, damaged, or incorrect items are reported on the order status page, which opens the issue form once your order is verified.",
  },
  {
    title: "Payment concerns",
    body: "The verified payment state is shown on the same order status page. Nothing here can read or change a payment.",
  },
  {
    title: "Store contact",
    body: "Pickup and delivery questions reach the store through the support form on the verified order status page. There is no separate contact route.",
  },
];

export default function OrderHelpPage() {
  return <div data-ui="atlas-guest-help" className="min-h-screen bg-[#f7f8f5] text-[#202826]">
    <header className="border-b border-[#e5e9e3] bg-white">
      <div className="mx-auto flex min-h-[77px] max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-10">
        <Link href="/order" aria-label="NexPOS storefront" className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
          <span aria-hidden className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[10px] bg-[#29332d] font-display text-[24px] font-semibold text-white">N</span>
          <span className="font-display text-[21px] font-semibold tracking-tight text-[#202826]">NexPOS</span>
        </Link>
        <nav aria-label="Order help navigation" className="flex flex-wrap items-center gap-4 text-[13px]">
          <Link href="/order" className="hover:underline">Shop</Link>
          <Link href="/order-status" className="text-[#748078] hover:text-[#202826] hover:underline">Track order</Link>
          <span className="rounded-md bg-[#e8f4ec] px-3 py-2 font-data text-[10px] font-semibold text-[#267552]">GUEST EXPERIENCE</span>
        </nav>
      </div>
    </header>
    <main className="mx-auto max-w-[1440px] space-y-8 px-5 pb-16 pt-12 sm:px-10">
      <header className="space-y-4">
        <p className="font-data text-[11px] font-medium tracking-[0.06em] text-[#da614c]">HELP &amp; ORDER SUPPORT</p>
        <h1 className="font-display text-[34px] font-semibold tracking-tight sm:text-[36px]">Need help with an order?</h1>
        <p className="text-[15px] text-[#748078]">A secure tracking link can be used without creating an account.</p>
      </header>
      <section aria-label="Order support paths" className="rounded-[14px] border border-[#e5e9e3] bg-white p-5 sm:p-7">
        <h2 className="font-display text-[23px] font-semibold">Choose what you need help with</h2>
        <div className="mt-7 grid gap-4 md:grid-cols-2">{paths.map((path, index) => {
          const surface = "flex min-h-[142px] flex-col justify-start rounded-[11px] px-5 py-5 " + (index === 1 ? "bg-[#fff0eb]" : "bg-[#f7f8f5]");
          const content = <>
            <span className="font-display text-[20px] font-semibold text-[#202826]">{path.title}{path.href ? <> <span aria-hidden className="inline-block transition-transform motion-safe:group-hover:translate-x-1">→</span></> : null}</span>
            <span className="mt-4 text-[14px] leading-6 text-[#748078]">{path.body}</span>
          </>;
          return path.href
            ? <Link key={path.title} href={path.href} data-ui="order-help-path-link"
              className={"group transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c] " + surface + (index === 1 ? " hover:bg-[#ffe7df]" : " hover:bg-[#e9f4ec]")}>{content}</Link>
            : <div key={path.title} data-ui="order-help-path-note" className={surface}>{content}</div>;
        })}</div>
      </section>
      <p className="text-xs text-[#748078]">For privacy, support requests open only after verifying your order through its secure status link. The reference number alone is not enough.</p>
    </main>
  </div>;
}
