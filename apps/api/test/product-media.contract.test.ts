import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";
import { FakeProductMediaStorage } from "./support/fake-product-media.storage";
import { ProductMediaCleanup } from "../src/catalog/media/product-media-cleanup";

let app: INestApplication;
let cookie = "";
let csrf = "";
let productId = "";
let photo: Buffer;
const fake = new FakeProductMediaStorage();
const origin = "http://localhost:3000";
let previousEnv: NodeJS.ProcessEnv;

function jar(value: unknown): string {
  const list = Array.isArray(value) ? value : [String(value ?? "")];
  return list.map((v) => String(v).split(";")[0]).join("; ");
}

beforeAll(async () => {
  previousEnv = process.env;
  process.env = {
    ...previousEnv, WEB_URL: origin, PRODUCT_MEDIA_ENABLED: "1",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "only-test-secret",
    PRODUCT_MEDIA_BUCKET: "nexpos-product-media",
  };
  photo = await sharp({create: {width: 20, height: 20, channels: 3, background: "#123456"}}).png().toBuffer();
  app = await createTestApp({ completedOnboardingFixture: true, productMediaStorage: fake });
  const registered = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Media QA", email: `media-owner-${Date.now()}@example.com`,
    password: "correct-horse-12", businessName: "Media QA Store",
  });
  expect(registered.status).toBe(201);
  cookie = jar(registered.headers["set-cookie"]);
  csrf = registered.body.csrfToken as string;
  const created = await request(app.getHttpServer()).post("/api/v1/products")
    .set("Cookie", cookie).set("X-CSRF-Token", csrf)
    .send({ name: "Oat Milk", priceMinor: 13500 });
  expect(created.status).toBe(201);
  productId = created.body.id as string;
});

afterAll(async () => {
  await app?.close();
  process.env = previousEnv;
});

describe("owner-only product media HTTP contract", () => {
  it("returns safe capabilities and hides all storage secrets", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/product-media/capabilities").set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ enabled: true, maxSourceBytes: 3 * 1024 * 1024 });
    expect(JSON.stringify(response.body)).not.toContain("only-test-secret");
  });

  it("rejects missing session, CSRF and Origin before parsing the image", async () => {
    const path = `/api/v1/products/${productId}/image`;
    const noSession = await request(app.getHttpServer()).post(path).set("Origin", origin).attach("image", photo, "milk.png");
    expect(noSession.status).toBe(401);
    const noCsrf = await request(app.getHttpServer()).post(path).set("Cookie", cookie)
      .set("Origin", origin).attach("image", photo, "milk.png");
    expect(noCsrf.status).toBe(403);
    const wrongOrigin = await request(app.getHttpServer()).post(path).set("Cookie", cookie)
      .set("X-CSRF-Token", csrf).set("Origin", "https://attacker.example").attach("image", photo, "milk.png");
    expect(wrongOrigin.status).toBe(403);
    expect(fake.paths()).toEqual([]);
  });

  it("uploads, shows the active asset, rejects stale version, and safely removes the photo", async () => {
    const path = `/api/v1/products/${productId}/image`;
    const created = await request(app.getHttpServer()).post(path).set("Cookie", cookie)
      .set("X-CSRF-Token", csrf).set("Origin", origin)
      .field("expectedAssetId", "").attach("image", photo, "milk.png");
    expect(created.status).toBe(201);
    expect(created.body.imageUrl).toContain("nexpos-product-media/businesses/");
    const version = created.body.assetId as string;
    expect(version).toBeTruthy();
    const status = await request(app.getHttpServer()).get(path).set("Cookie", cookie);
    expect(status.body).toEqual({ imageUrl: created.body.imageUrl, assetId: version });

    const stale = await request(app.getHttpServer()).post(path).set("Cookie", cookie)
      .set("X-CSRF-Token", csrf).set("Origin", origin)
      .field("expectedAssetId", "").attach("image", photo, "milk.png");
    expect(stale.status).toBe(409);
    expect(fake.paths()).toHaveLength(1);
    const invalid = await request(app.getHttpServer()).post(path).set("Cookie", cookie)
      .set("X-CSRF-Token", csrf).set("Origin", origin)
      .attach("image", Buffer.from("<svg><script>alert(1)</script></svg>"), { filename: "script.svg", contentType: "image/svg+xml" });
    expect(invalid.status).toBe(415);

    const missingCsrf = await request(app.getHttpServer()).delete(path)
      .set("Cookie", cookie).set("Origin", origin).send({ expectedAssetId: version });
    expect(missingCsrf.status).toBe(403);
    const removed = await request(app.getHttpServer()).delete(path)
      .set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Origin", origin)
      .send({ expectedAssetId: version });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ imageUrl: null, assetId: null });
    await app.get(ProductMediaCleanup).sweep();
    expect(fake.paths()).toEqual([]);
  });

  it("returns NOT_FOUND for another business product ID", async () => {
    const second = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Other Owner", email: `other-media-${Date.now()}@example.com`,
      password: "correct-horse-12", businessName: "Other Media Store",
    });
    const response = await request(app.getHttpServer()).post(`/api/v1/products/${productId}/image`)
      .set("Cookie", jar(second.headers["set-cookie"]))
      .set("X-CSRF-Token", second.body.csrfToken as string)
      .set("Origin", origin)
      .attach("image", photo, "milk.png");
    expect(response.status).toBe(404);
  });
});
