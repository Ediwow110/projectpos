import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";

describe("config env separation PLAN 14.1", () => {
  it("reads DATABASE_URL and NODE_ENV", () => {
    const env = loadEnv({ DATABASE_URL: "postgresql://pos:pos@localhost:5432/pos", NODE_ENV: "test" } as any);
    expect(env.databaseUrl).toBe("postgresql://pos:pos@localhost:5432/pos");
    expect(env.nodeEnv).toBe("test");
  });
  it("defaults ports when unset", () => {
    const env = loadEnv({ DATABASE_URL: "postgresql://x" } as any);
    expect(env.apiPort).toBe(3001);
    expect(env.webPort).toBe(3000);
  });
  it("throws on missing DATABASE_URL", () => {
    expect(() => loadEnv({} as any)).toThrow("ENV_MISSING_DATABASE_URL");
  });
});
