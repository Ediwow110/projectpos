import { ApiError, apiFetch } from "./api";

const MAX_READINESS_RETRIES = 6;

export function readinessDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 15000);
}

export function isTransientReadinessError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === "AUTH_INVALID_CREDENTIALS" || error.status === 401 || error.status === 403) return false;
  if (error.code === "NETWORK_ERROR" || error.code === "NETWORK_TIMEOUT") return error.status === 0;
  return error.status === 502 || error.status === 503 || error.status === 504;
}

export interface ReadinessOptions<T = unknown> {
  probe?: () => Promise<T>;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForApiReady<T = { ok: boolean }>(options: ReadinessOptions<T> = {}): Promise<T> {
  const probe = options.probe ?? (() => apiFetch<T>("/readyz", { init: { method: "GET" } }));
  const sleep = options.sleep ?? defaultSleep;
  const requestedRetries = options.maxRetries ?? MAX_READINESS_RETRIES;
  const maxRetries = Number.isFinite(requestedRetries)
    ? Math.min(Math.max(Math.floor(requestedRetries), 0), MAX_READINESS_RETRIES)
    : MAX_READINESS_RETRIES;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await probe();
    } catch (error) {
      if (!isTransientReadinessError(error) || attempt >= maxRetries) throw error;
      await sleep(readinessDelay(attempt));
    }
  }
}
