import { describe, expect, it } from "vitest";
import { fetchStatus } from "../src/status";

describe("Phase 0 web status", () => {
  it("returns scoped me payload from api base", async () => {
    const res = await fetchStatus("http://localhost:3001", async () => ({
      businessId: "biz_1",
      userId: "user_1",
      requestId: "req_1",
      timestamp: "2026-09-21T00:00:00.000Z",
    }));
    expect(res.ok).toBe(true);
    expect(res.me?.businessId).toBe("biz_1");
  });
  it("marks unauthorized when api throws", async () => {
    const res = await fetchStatus("http://localhost:3001", async () => {
      throw new Error("TENANT_REQUIRED");
    });
    expect(res.ok).toBe(false);
  });
});
