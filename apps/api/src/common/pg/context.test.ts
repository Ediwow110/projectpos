import { describe, expect, it } from "vitest";
import { PgContext, resolvePoolMax } from "./context";

describe("PgContext pool sizing", () => {
  it("clamps an unusable PG_POOL_MAX to the measured default instead of handing pg NaN", () => {
    // `PG_POOL_MAX=` from a valueless flag or a typo yields Number("") === 0 and
    // Number("abc") === NaN; both used to be passed straight to the pool.
    expect(resolvePoolMax({})).toBe(30);
    for (const raw of ["", "abc", "0", "-5", "1.5", "NaN", "Infinity"]) {
      expect(resolvePoolMax({ PG_POOL_MAX: raw })).toBe(30);
    }
    expect(resolvePoolMax({ PG_POOL_MAX: "12" })).toBe(12);
  });

  it("builds the pool with the clamped maximum", () => {
    const restore = captureEnv(["PG_POOL_MAX"]);
    try {
      process.env["PG_POOL_MAX"] = "";
      const context = new PgContext("postgresql://unused:unused@localhost:5432/unused");
      expect((context as unknown as { pool: { options: { max: number } } }).pool.options.max).toBe(30);
    } finally {
      restore();
    }
  });
});

function captureEnv(names: string[]): () => void {
  const originals = names.map((name) => [name, process.env[name]] as const);
  return () => {
    for (const [name, value] of originals) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
