export class ApiError extends Error {
  code: string;
  correlationId: string;
  status: number;
  fields: Record<string, string[]>;
  constructor(
    code: string,
    message: string,
    correlationId: string,
    status: number,
    fields: Record<string, string[]> = {},
  ) {
    super(message);
    this.code = code;
    this.correlationId = correlationId;
    this.status = status;
    this.fields = fields;
  }
}

const API_BASE =
  (typeof process !== "undefined" && process.env["NEXT_PUBLIC_API_BASE"]) ||
  "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function transientHttpError(status: number): { code: string; message: string } {
  if (status === 502 || status === 503 || status === 504) {
    return { code: "SERVICE_UNAVAILABLE", message: "The service is temporarily unavailable." };
  }
  return { code: "HTTP_ERROR", message: "Request failed." };
}

export function apiBase(): string {
  return API_BASE;
}

export async function apiFetch<T>(
  path: string,
  opts: { csrfToken?: string; init?: RequestInit; timeoutMs?: number } = {},
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.init?.signal
    ? AbortSignal.any([opts.init.signal, timeoutSignal])
    : timeoutSignal;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...opts.init,
      signal,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(opts.csrfToken ? { "X-CSRF-Token": opts.csrfToken } : {}),
        ...((opts.init?.headers ?? {}) as Record<string, string>),
      },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError") {
      throw new ApiError("NETWORK_TIMEOUT", "The request timed out.", "", 0);
    }
    if (name === "AbortError") throw error;
    throw new ApiError("NETWORK_ERROR", "Could not reach the API.", "", 0);
  }
  const status = res.status ?? (res.ok ? 200 : 0);
  let body: unknown;
  let parsed = false;
  try {
    const raw = typeof res.text === "function" ? await res.text() : null;
    if (raw !== null) {
      if (raw.trim()) {
        body = JSON.parse(raw);
        parsed = true;
      }
    } else if (typeof res.json === "function") {
      body = await res.json();
      parsed = true;
    }
  } catch {
    if (!res.ok) {
      const fallback = transientHttpError(status);
      throw new ApiError(fallback.code, fallback.message, "", status);
    }
    throw new ApiError("INVALID_RESPONSE", "The API returned an invalid response.", "", status);
  }
  if (!res.ok) {
    const envelope = isRecord(body) ? body : {};
    const fallback = transientHttpError(status);
    throw new ApiError(
      typeof envelope.code === "string" ? envelope.code : fallback.code,
      typeof envelope.message === "string" ? envelope.message : fallback.message,
      typeof envelope.correlationId === "string" ? envelope.correlationId : "",
      status,
      isRecord(envelope.fields) ? envelope.fields as Record<string, string[]> : {},
    );
  }
  if (!parsed) {
    throw new ApiError("INVALID_RESPONSE", "The API returned an invalid response.", "", status);
  }
  return body as T;
}
