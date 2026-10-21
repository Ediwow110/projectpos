import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PosPaymentMethodChooser } from "./PosPaymentMethodChooser";

const noop = () => undefined;

describe("Atlas V4 payment method chooser", () => {
  it("displays the primary Figma choices without disguising disabled PayMongo methods", () => {
    const html = renderToStaticMarkup(
      <PosPaymentMethodChooser effectiveMethod="cash" offline={false}
        methodAvailable={(method) => method === "cash"} onMethodChange={noop}
        onContinue={noop} onMoreMethods={noop} onClose={noop} />,
    );
    expect(html).toContain('data-ui="atlas-v4-payment-chooser"');
    expect(html).toContain("Choose a payment method");
    expect(html).toContain("Card via PayMongo");
    expect(html).toContain("QR Ph via PayMongo");
    expect(html).toContain('aria-label="QR Ph" aria-pressed="false" disabled=""');
    expect(html).toContain("Other payment methods");
    expect(html).toContain('aria-label="Back to sale"');
    expect(html).toContain("Continue");
  });

  it("blocks Continue when a previously selected hosted method becomes unavailable", () => {
    const html = renderToStaticMarkup(
      <PosPaymentMethodChooser effectiveMethod="qrph" offline
        methodAvailable={() => true} onMethodChange={noop}
        onContinue={noop} onMoreMethods={noop} onClose={noop} />,
    );
    expect(html).toMatch(/disabled=""[^>]*>Continue/);
  });

  it("marks the element its Escape/Tab focus trap is bound to", () => {
    const html = renderToStaticMarkup(
      <PosPaymentMethodChooser effectiveMethod="cash" offline={false}
        methodAvailable={() => true} onMethodChange={noop}
        onContinue={noop} onMoreMethods={noop} onClose={noop} />,
    );
    // The key handling itself is a DOM event and cannot be exercised by
    // renderToStaticMarkup; the marker plus aria-modal is the markup contract.
    expect(html).toContain('data-focus-trap="true"');
    expect(html).toContain('aria-modal="true"');
  });

  it("keeps the overflow action at 44px and the eyebrow/description on text-safe tokens", () => {
    const html = renderToStaticMarkup(
      <PosPaymentMethodChooser effectiveMethod="cash" offline={false}
        methodAvailable={() => true} onMethodChange={noop}
        onContinue={noop} onMoreMethods={noop} onClose={noop} />,
    );
    expect(html).toContain('class="mt-3 min-h-11 text-[12px]');
    expect(html).not.toContain("min-h-9");
    expect(html).not.toContain("text-[#da614c]");
    expect(html).not.toContain("text-[#71807a]");
    expect(html).toContain("text-[var(--color-atlas-accent-strong)]");
    expect(html).toContain("text-[var(--color-atlas-muted-strong)]");
    // #da614c stays where it is a non-text indicator: the focus outline.
    expect(html).toContain("focus-visible:outline-[#da614c]");
  });
});
