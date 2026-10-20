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
});
