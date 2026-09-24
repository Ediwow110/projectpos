import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { incrementMetric } from "./metrics";

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    incrementMetric("pos_http_requests_total", {
      method: req.method,
      status: String(res.statusCode),
    });
  });
  next();
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    httpMetrics(req, res, next);
  }
}
