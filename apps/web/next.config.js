/** @type {import('next').NextConfig} */
function apiConnectOrigin() {
  const raw = process.env["NEXT_PUBLIC_API_BASE"]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function apiProxyTarget() {
  const raw = process.env["API_PROXY_TARGET"]?.trim().replace(/\/+$/, "");
  if (!raw) return null;
  const candidate = raw.includes("://") ? raw : `http://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

function contentSecurityPolicy() {
  const production = process.env["NODE_ENV"] === "production";
  const connectSources = new Set(["'self'"]);
  const apiOrigin = apiConnectOrigin();
  if (apiOrigin) connectSources.add(apiOrigin);
  else if (!production) connectSources.add("http://localhost:3001");
  if (!production) {
    connectSources.add("ws:");
    connectSources.add("wss:");
  }

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${production ? "" : " 'unsafe-eval'"}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${[...connectSources].join(" ")} https://challenges.cloudflare.com`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src https://challenges.cloudflare.com",
    "manifest-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
  ];
  if (production) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

const nextConfig = {
  distDir: process.env["NEXT_DIST_DIR"]?.trim() || ".next",
  async rewrites() {
    const target = apiProxyTarget();
    if (!target) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${target}/api/:path*`,
      },
    ];
  },
  async headers() {
    const production = process.env["NODE_ENV"] === "production";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(production
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};
export default nextConfig;
