import { describe, expect, it } from "vitest";
import { FirstPartyOriginGuard } from "./first-party-origin.guard";

function context(origin: string | undefined) {
  const req: { headers: Record<string, string | undefined>; authError?: string } = {
    headers: { origin },
  };
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as any,
  };
}

describe("phase22 first-party origin guard", () => {
  it("accepts only the exact normalized WEB_URL origin", () => {
    const guard = new FirstPartyOriginGuard({ WEB_URL: "https://shop.example.com/base/" });
    expect(guard.canActivate(context("https://shop.example.com").ctx)).toBe(true);

    for (const origin of [undefined, "https://evil.example.com", "https://shop.example.com.evil.tld", "http://shop.example.com"]) {
      const input = context(origin);
      expect(guard.canActivate(input.ctx)).toBe(false);
      expect(input.req.authError).toBe("FORBIDDEN");
    }
  });

  it("fails closed when WEB_URL is missing or invalid", () => {
    expect(new FirstPartyOriginGuard({}).canActivate(context("http://localhost:3100").ctx)).toBe(false);
    expect(new FirstPartyOriginGuard({ WEB_URL: "not-a-url" }).canActivate(context("http://localhost:3100").ctx)).toBe(false);
  });
});
