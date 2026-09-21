import type { ApiErrorEnvelope } from "@pos/types";

export function error(
  code: string,
  message: string,
  correlationId: string,
  fields?: Record<string, string[]>,
): ApiErrorEnvelope {
  return fields === undefined
    ? { code, message, correlationId }
    : { code, message, correlationId, fields };
}
