import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const lockPath = resolve(".e2e-run.lock");
const apiCli = resolve("apps/api/node_modules/tsx/dist/cli.mjs");
const nextCli = resolve("apps/web/node_modules/next/dist/bin/next");
const playwrightCli = resolve("node_modules/@playwright/test/cli.js");
let apiServer;
let webServer;

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (existsSync(lockPath)) {
  const previousPid = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
  if (pidAlive(previousPid)) {
    throw new Error(`Another E2E run is already active (pid ${previousPid}).`);
  }
  rmSync(lockPath, { force: true });
}
const lockFd = openSync(lockPath, "wx");
writeFileSync(lockFd, String(process.pid));
closeSync(lockFd);
const releaseLock = () => rmSync(lockPath, { force: true });
function stopTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGTERM");
}
function releaseServers() {
  stopTree(webServer);
  stopTree(apiServer);
}
process.on("exit", () => {
  releaseServers();
  releaseLock();
});
process.on("SIGINT", () => {
  releaseServers();
  releaseLock();
  process.exit(130);
});
process.on("SIGTERM", () => {
  releaseServers();
  releaseLock();
  process.exit(143);
});

const webBuildEnv = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_PUBLIC_API_BASE: "http://localhost:3100",
  API_PROXY_TARGET: "http://localhost:3101",
};
const apiEnv = {
  ...process.env,
  NODE_ENV: "development",
  TSX_TSCONFIG_PATH: resolve("apps/api/tsconfig.json"),
  API_PORT: "3101",
  WEB_URL: "http://localhost:3100",
  REGISTRATION_RATE_LIMIT: "1000",
  LOGIN_RATE_LIMIT: "1000",
  AUTH_REQUIRE_EMAIL_VERIFICATION: "0",
  BILLING_ENABLED: "0",
  PLATFORM_API_KEY: process.env.PLATFORM_API_KEY ?? "test-platform-key",
  BILLING_TEST_DOUBLE_SECRET: process.env.BILLING_TEST_DOUBLE_SECRET ?? "test-webhook-secret",
  APPROVAL_QUEUE_ENCRYPTION_KEY: process.env.APPROVAL_QUEUE_ENCRYPTION_KEY ?? "a4".repeat(32),
};

async function waitForServer(url, child, label, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready (exit ${child.exitCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Listener may not be bound yet.
    }
    await delay(250);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

rmSync("apps/web/.next", { recursive: true, force: true });

try {
  const build = spawnSync(
    process.execPath,
    [nextCli, "build", "apps/web"],
    { env: webBuildEnv, stdio: "inherit" },
  );
  if (build.status !== 0) {
    process.exitCode = build.status ?? 1;
  } else {
    apiServer = spawn(
      process.execPath,
      [apiCli, "apps/api/src/main.ts"],
      { env: apiEnv, stdio: "inherit", windowsHide: true },
    );
    webServer = spawn(
      process.execPath,
      [nextCli, "start", "apps/web", "-p", "3100"],
      { env: webBuildEnv, stdio: "inherit", windowsHide: true },
    );

    await Promise.all([
      waitForServer("http://localhost:3101/healthz", apiServer, "API"),
      waitForServer("http://localhost:3100/login", webServer, "web"),
    ]);

    const forwarded = process.argv.slice(2);
    if (forwarded[0] === "--") forwarded.shift();

    const playwright = spawnSync(
      process.execPath,
      [playwrightCli, "test", ...forwarded],
      {
        env: { ...process.env, E2E_EXTERNAL_SERVERS: "1" },
        stdio: "inherit",
      },
    );
    process.exitCode = playwright.status ?? 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  releaseServers();
  releaseLock();
}
