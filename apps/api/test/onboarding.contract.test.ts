import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;
let cookie: string;
let csrf: string;

function jar(header: unknown): string {
  const values = Array.isArray(header) ? header : [String(header ?? "")];
  return values.map((value) => String(value).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
  const registration = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({
      ownerName: "Onboarding Contract Owner",
      email: `onboarding-contract-${Date.now()}@example.com`,
      password: "correct-horse-12",
      businessName: "Onboarding Contract Store",
    });
  expect(registration.status).toBe(201);
  cookie = jar(registration.headers["set-cookie"]);
  csrf = registration.body.csrfToken as string;
});

afterAll(async () => {
  await app.close();
});

describe("onboarding HTTP contract", () => {
  it.each(["businessDetails", "taxCurrency", "receiptSetup"] as const)(
    "rejects a direct API attempt to skip required step %s without changing saved progress",
    async (step) => {
      const before = await request(app.getHttpServer())
        .get("/api/v1/onboarding")
        .set("Cookie", cookie);
      expect(before.status).toBe(200);

      const bypass = await request(app.getHttpServer())
        .patch("/api/v1/onboarding")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({ step, state: "skipped" });
      expect(bypass.status).toBe(400);
      expect(bypass.body.code).toBe("ONBOARDING_REQUIRED_STEP");

      const after = await request(app.getHttpServer())
        .get("/api/v1/onboarding")
        .set("Cookie", cookie);
      expect(after.body).toEqual(before.body);
    },
  );

  it("rejects unauthenticated and CSRF-less onboarding writes", async () => {
    const signedOut = await request(app.getHttpServer())
      .patch("/api/v1/onboarding")
      .send({ step: "taxCurrency", state: "done" });
    expect(signedOut.status).toBe(401);

    const missingCsrf = await request(app.getHttpServer())
      .patch("/api/v1/onboarding")
      .set("Cookie", cookie)
      .send({ step: "taxCurrency", state: "done" });
    expect(missingCsrf.status).toBe(403);
    expect(["CSRF_MISMATCH", "CSRF_REQUIRED"]).toContain(missingCsrf.body.code);
  });

  it("persists valid required-step progress and blocks workspace API access while setup remains incomplete", async () => {
    const configured = await request(app.getHttpServer())
      .patch("/api/v1/business/settings")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ currency: "PHP", taxName: "VAT", taxRateBps: 1200 });
    expect(configured.status).toBe(200);
    expect(configured.body.settings).toMatchObject({ currency: "PHP", taxName: "VAT", taxRateBps: 1200 });

    const saved = await request(app.getHttpServer())
      .patch("/api/v1/onboarding")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ step: "taxCurrency", state: "done" });
    expect(saved.status).toBe(200);
    expect(saved.body.steps.taxCurrency).toBe("done");
    expect(saved.body.steps.receiptSetup).toBe("pending");

    const reloaded = await request(app.getHttpServer())
      .get("/api/v1/onboarding")
      .set("Cookie", cookie);
    expect(reloaded.body).toEqual(saved.body);

    const dashboard = await request(app.getHttpServer())
      .get("/api/v1/dashboard/overview?dateFrom=2020-01-01T00:00:00.000Z&dateTo=2020-02-01T00:00:00.000Z&compare=none")
      .set("Cookie", cookie);
    expect(dashboard.status).toBe(403);
    expect(dashboard.body.code).toBe("ONBOARDING_REQUIRED");

    for (const path of ["/api/v1/products", "/api/v1/inventory/balances"]) {
      const blocked = await request(app.getHttpServer()).get(path).set("Cookie", cookie);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe("ONBOARDING_REQUIRED");
    }

    const write = await request(app.getHttpServer()).post("/api/v1/products")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ name: "Blocked before setup", priceMinor: 100 });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("ONBOARDING_REQUIRED");

    const unrelatedSetting = await request(app.getHttpServer()).patch("/api/v1/business/settings")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ onlineOrderingEnabled: true });
    expect(unrelatedSetting.status).toBe(403);
    expect(unrelatedSetting.body.code).toBe("ONBOARDING_REQUIRED");

    const setupSetting = await request(app.getHttpServer()).patch("/api/v1/business/settings")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ taxName: "VAT" });
    expect(setupSetting.status).toBe(200);
  });

  it("opens workspace APIs when required steps are complete, even with optional steps pending", async () => {
    const bypass = await request(app.getHttpServer())
      .patch("/api/v1/onboarding")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ step: "receiptSetup", state: "done" });
    expect(bypass.status).toBe(400);
    expect(bypass.body.code).toBe("ONBOARDING_SETTINGS_REQUIRED");

    const saved = await request(app.getHttpServer())
      .patch("/api/v1/onboarding")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ step: "receiptSetup", state: "done", receiptPreviewConfirmed: true });
    expect(saved.status).toBe(200);
    expect(saved.body.steps.products).toBe("pending");
    expect(saved.body.steps.employees).toBe("pending");

    for (const path of ["/api/v1/dashboard/overview?compare=none", "/api/v1/products", "/api/v1/inventory/balances"]) {
      const allowed = await request(app.getHttpServer()).get(path).set("Cookie", cookie);
      expect(allowed.status).toBe(200);
      if (path === "/api/v1/products") expect(allowed.body.items).toEqual([]);
    }
  });

  it("allows optional steps to be skipped through the API", async () => {
    const skipped = await request(app.getHttpServer())
      .patch("/api/v1/onboarding")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ step: "products", state: "skipped" });
    expect(skipped.status).toBe(200);
    expect(skipped.body.steps.products).toBe("skipped");
  });
});
