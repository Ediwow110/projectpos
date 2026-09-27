import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const salesServiceSource = readFileSync(
  "src/sales/nest/sales.service.ts",
  "utf8",
);

describe("sales service decomposition", () => {
  it("delegates lifecycle and PayMongo webhook responsibilities to focused services", () => {
    expect(salesServiceSource).toContain("SalesLifecycleService");
    expect(salesServiceSource).toContain("SalesPayMongoWebhookService");
    expect(salesServiceSource).toContain("this.lifecycle = new SalesLifecycleService");
    expect(salesServiceSource).toContain("this.paymongoWebhooks = new SalesPayMongoWebhookService");

    expect(salesServiceSource).not.toContain("private async settlePayMongoPaid");
    expect(salesServiceSource).not.toContain("fingerprintPayload");
    expect(salesServiceSource).not.toContain("transitionSale");
  });
});
