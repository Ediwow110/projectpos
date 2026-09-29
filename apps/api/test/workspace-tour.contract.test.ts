import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "../src/app.module";

let app: INestApplication;

function jar(h: unknown): string {
  const arr = Array.isArray(h) ? h : [String(h ?? "")];
  return arr.map((c) => String(c).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

describe("workspace tour preference", () => {
  it("is unseen for a new user, then persists after dismissal", async () => {
    const reg = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
      ownerName: "Tour Owner",
      email: `tour-${Date.now()}@example.com`,
      password: "correct-horse-12",
      businessName: "Tour Store",
    });
    expect(reg.status).toBe(201);
    const cookie = jar(reg.headers["set-cookie"]);
    const csrf = reg.body.csrfToken as string;

    const before = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookie);
    expect(before.status).toBe(200);
    expect(before.body.workspaceTourSeen).toBe(false);

    const marked = await request(app.getHttpServer()).post("/api/v1/me/tour/seen")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf);
    expect(marked.status).toBe(200);
    expect(marked.body.workspaceTourSeen).toBe(true);

    const after = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookie);
    expect(after.status).toBe(200);
    expect(after.body.workspaceTourSeen).toBe(true);
  });
});
