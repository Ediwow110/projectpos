import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { error } from "../errors";
import { getCorrelationId } from "../correlation";
import { statusFor } from "./http-helpers";

@Catch()
export class AuthErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    if (res.headersSent) return;
    const authError = (req as Request & { authError?: string }).authError;
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
    }
    const correlationId =
      (req as Request & { correlationId?: string }).correlationId ?? getCorrelationId(headers);
    if (authError) {
      res
        .status(statusFor(authError, 401))
        .json(error(authError, authError, correlationId));
      return;
    }
    if (exception instanceof Error) {
      // Body-parser payload-too-large errors carry status 413: surface them
      // as 413 PAYLOAD_TOO_LARGE instead of a generic 500.
      const status = (exception as { status?: unknown }).status;
      if (status === 413) {
        res.status(413).json(error("PAYLOAD_TOO_LARGE", "Request body too large", correlationId));
        return;
      }
      // Other Nest HttpExceptions (e.g. malformed JSON bodies surfacing as
      // 400 BadRequestException) keep their status instead of masking as 500.
      // Codes stay within the stable envelope vocabulary.
      if (status === 400) {
        res.status(400).json(error("VALIDATION", "Invalid request", correlationId));
        return;
      }
      if (status === 403) {
        res.status(403).json(error("FORBIDDEN", "Forbidden", correlationId));
        return;
      }
      if (status === 404) {
        res.status(404).json(error("NOT_FOUND", "Not found", correlationId));
        return;
      }
      res.status(500).json(error("INTERNAL", "Internal error", correlationId));
      return;
    }
    res.status(500).json(error("INTERNAL", "Internal error", correlationId));
  }
}
