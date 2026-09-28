import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORIGINAL_PROXY_TARGET = process.env["API_PROXY_TARGET"];
const ORIGINAL_DIST_DIR = process.env["NEXT_DIST_DIR"];
const ORIGINAL_API_BASE = process.env["NEXT_PUBLIC_API_BASE"];

afterEach(() => {
  if (ORIGINAL_PROXY_TARGET === undefined) delete process.env["API_PROXY_TARGET"];
  else process.env["API_PROXY_TARGET"] = ORIGINAL_PROXY_TARGET;
  if (ORIGINAL_DIST_DIR === undefined) delete process.env["NEXT_DIST_DIR"];
  else process.env["NEXT_DIST_DIR"] = ORIGINAL_DIST_DIR;
  if (ORIGINAL_API_BASE === undefined) delete process.env["NEXT_PUBLIC_API_BASE"];
  else process.env["NEXT_PUBLIC_API_BASE"] = ORIGINAL_API_BASE;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Next.js web runtime configuration", () => {
  it("proxies /api requests through the web origin when a backend target is configured", async () => {
    process.env["API_PROXY_TARGET"] = "https://nexpos-api.onrender.com";
    const { default: nextConfig } = await import("../next.config.js");

    const rewrites = await nextConfig.rewrites?.();

    expect(rewrites).toEqual([
      {
        source: "/api/:path*",
        destination: "https://nexpos-api.onrender.com/api/:path*",
      },
    ]);
  });

  it("accepts Render private-network host:port proxy targets", async () => {
    process.env["API_PROXY_TARGET"] = "nexpos-api:10000";
    const { default: nextConfig } = await import("../next.config.js");

    const rewrites = await nextConfig.rewrites?.();

    expect(rewrites).toEqual([
      {
        source: "/api/:path*",
        destination: "http://nexpos-api:10000/api/:path*",
      },
    ]);
  });

  it("uses an isolated Next output directory when NEXT_DIST_DIR is configured", async () => {
    process.env["NEXT_DIST_DIR"] = ".next-e2e";
    const { default: nextConfig } = await import("../next.config.js");

    expect(nextConfig.distDir).toBe(".next-e2e");
  });

  it("ships a restrictive browser Content-Security-Policy", async () => {
    process.env["NEXT_PUBLIC_API_BASE"] = "https://nexpos-web.onrender.com";
    const { default: nextConfig } = await import("../next.config.js");

    const rules = await nextConfig.headers?.();
    const csp = rules?.[0]?.headers.find((header) => header.key === "Content-Security-Policy")?.value;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("connect-src 'self' https://nexpos-web.onrender.com");
  });

  it("keeps development-only script and HMR allowances out of production CSP", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env["NEXT_PUBLIC_API_BASE"] = "https://nexpos-web.onrender.com";
    const { default: nextConfig } = await import("../next.config.js");

    const rules = await nextConfig.headers?.();
    const csp = rules?.[0]?.headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";

    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("ws:");
    expect(csp).not.toContain("wss:");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("enables HSTS on the production web surface", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { default: nextConfig } = await import("../next.config.js");

    const rules = await nextConfig.headers?.();
    const hsts = rules?.[0]?.headers.find((header) => header.key === "Strict-Transport-Security")?.value;

    expect(hsts).toBe("max-age=31536000; includeSubDomains");
  });

  it("keeps the Render deployment wired from one web image and cross-service env references", () => {
    const root = resolve(process.cwd(), "../..");
    const blueprint = readFileSync(resolve(root, "render.yaml"), "utf8");
    const dockerfile = readFileSync(resolve(root, "docker/web.Dockerfile"), "utf8");
    const apiService = blueprint.split("  - type: web\n    name: nexpos-web")[0] ?? "";

    expect(blueprint).toContain("dockerfilePath: ./docker/web.Dockerfile");
    expect(blueprint).not.toContain("web.render.Dockerfile");
    expect(apiService).toContain("healthCheckPath: /readyz");
    expect(blueprint).toMatch(/key: NEXT_PUBLIC_API_BASE[\s\S]*?fromService:[\s\S]*?envVarKey: WEB_URL/);
    expect(blueprint).toMatch(/key: API_PROXY_TARGET[\s\S]*?fromService:[\s\S]*?envVarKey: RENDER_EXTERNAL_URL/);
    expect(apiService).toContain("key: PAYMONGO_SECRET_KEY");
    expect(apiService).toContain("key: PAYMONGO_WEBHOOK_SECRET");
    expect(dockerfile).toContain("ARG API_PROXY_TARGET");
    expect(dockerfile).toContain("API_PROXY_TARGET=$API_PROXY_TARGET");
  });
});
