import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LoyaltySettingsForm } from "./LoyaltySettingsForm";
import type { LoyaltySettingsForm as Form } from "../../../lib/loyalty-settings";

const form: Form = {
  enabled: true,
  earnAmount: "1.00",
  earnPoints: "1",
  redeemPoints: "10",
  redeemValue: "1.00",
  minimumRedeemPoints: "10",
};

describe("loyalty settings UI", () => {
  it("renders an accessible no-program setup state with currency-friendly rules", () => {
    const html = renderToStaticMarkup(<LoyaltySettingsForm form={form} errors={{}} busy={false} noProgram onChange={() => undefined} onSubmit={vi.fn()} />);
    expect(html).toContain("No loyalty program is configured yet");
    expect(html).toContain('aria-label="Enable loyalty program"');
    expect(html).toContain('for="earnAmount"');
    expect(html).toContain("₱1.00 spend → 1 points");
    expect(html).toContain("10 points → ₱1.00");
    expect(html).toContain("Save loyalty settings");
  });

  it("associates validation messages with invalid fields", () => {
    const html = renderToStaticMarkup(<LoyaltySettingsForm form={form} errors={{ earnAmount: "Enter a currency amount greater than ₱0.00." }} busy={false} noProgram={false} onChange={() => undefined} onSubmit={vi.fn()} />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="earnAmount-description earnAmount-error"');
    expect(html).toContain('id="earnAmount-error"');
  });
});
