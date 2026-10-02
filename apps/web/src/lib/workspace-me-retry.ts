import { ApiError } from "./api";

export function workspaceMeRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false;
  return failureCount < 6;
}

export function workspaceMeRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 15000);
}
