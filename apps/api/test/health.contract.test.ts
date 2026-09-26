import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response } from "express";
import { createTestApp } from "../src/app.module";
import { HealthController } from "../src/common/health.controller";

let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

// Minimal express-shaped response: status()/json() chain like the real thing.
interface FakeRes {
  _status: number;
  _body: unknown;
  status(s: number): FakeRes;
  json(b: unknown): FakeRes;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    _status: 0,
    _body: undefined,
    status(s: number) {
      res._status = s;
      return res;
    },
    json(b: unknown) {
      res._body = b;
      return res;
    },
  };
  return res;
}

const fakeReq = { headers: {} } as Request;

interface StubClient {
  query: () => Promise<unknown>;
  release: () => void;
  released: number;
}

function stubClient(): StubClient {
  const client: StubClient = {
    query: async () => ({ rowCount: 1 }),
    release: () => {
      client.released += 1;
    },
    released: 0,
  };
  return client;
}

describe("public health probes", () => {
  it("healthz answers unauthenticated with just ok", async () => {
    const res = await request(app.getHttpServer()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("readyz answers ok without a session when the store is in-process", async () => {
    const res = await request(app.getHttpServer()).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("readyz returns 503 when the pg store cannot be reached", async () => {
    const failing = { client: async () => { throw new Error("ECONNREFUSED"); } };
    const controller = new HealthController(failing as never);
    const res = fakeRes();
    await controller.ready(fakeReq, res as unknown as Response);
    expect(res._status).toBe(503);
    expect((res._body as { code: string }).code).toBe("NOT_READY");
  });

  it("readyz probes the pg store with SELECT 1 and releases the client", async () => {
    const client = stubClient();
    const ok = { client: async () => client, owns: () => true };
    const controller = new HealthController(ok as never);
    const res = fakeRes();
    await controller.ready(fakeReq, res as unknown as Response);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
    expect(client.released).toBe(1);
  });

  it("readyz does not release a client owned by an outer transaction", async () => {
    const client = stubClient();
    client.release = () => {
      throw new Error("must not release a borrowed client");
    };
    const ok = { client: async () => client, owns: () => false };
    const controller = new HealthController(ok as never);
    const res = fakeRes();
    await controller.ready(fakeReq, res as unknown as Response);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
  });
});
