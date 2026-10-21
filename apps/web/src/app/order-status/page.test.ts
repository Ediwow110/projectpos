import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "src/app/order-status/page.tsx"), "utf8");

describe("order status payment retry wiring", () => {
  it("offers the retry the page already promises in its failure copy", () => {
    expect(pageSource).toContain("OrderPaymentRetry");
    expect(pageSource).toContain("order={status}");
  });
});
