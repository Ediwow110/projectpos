import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { workspaceMeRetry, workspaceMeRetryDelay } from "./workspace-me-retry";

describe("workspace me bounded retry", () => {
  it("never retries real auth denial", () => {
    expect(workspaceMeRetry(0, new ApiError("DENIED", "no", "", 401))).toBe(false);
    expect(workspaceMeRetry(0, new ApiError("FORBIDDEN", "no", "", 403))).toBe(false);
  });

  it("retries transient failures up to a bounded budget", () => {
    expect(workspaceMeRetry(0, new ApiError("DOWN", "down", "", 503))).toBe(true);
    expect(workspaceMeRetry(5, new ApiError("DOWN", "down", "", 503))).toBe(true);
    expect(workspaceMeRetry(6, new ApiError("DOWN", "down", "", 503))).toBe(false);
    expect(workspaceMeRetry(0, new ApiError("NETWORK_ERROR", "offline", "", 0))).toBe(true);
  });

  it("caps the backoff delay", () => {
    expect(workspaceMeRetryDelay(0)).toBe(1000);
    expect(workspaceMeRetryDelay(3)).toBe(8000);
    expect(workspaceMeRetryDelay(10)).toBe(15000);
  });
});
