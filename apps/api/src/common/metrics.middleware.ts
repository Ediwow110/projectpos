import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { incrementMetric } from "./metrics";

function routeLabel(req: Request): string {
  return (req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path).slice(0, 120);
}

function domainForRoute(route: string): "sales" | "payment" | "refund" | "inventory" | "stored_value" | null {
  if (route.includes("/sales")) return "sales";
  if (route.includes("/payments")) return "payment";
  if (route.includes("/refund")) return "refund";
  if (route.includes("/inventory")) return "inventory";
  if (route.includes("gift-card") || route.includes("stored-value") || route.includes("loyalty")) return "stored_value";
  return null;
}

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const route = routeLabel(req);
    const status = String(res.statusCode);
    const outcome = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "rejected" : "success";
    incrementMetric("pos_http_requests_total", {
      method: req.method,
      route,
      status: String(res.statusCode),
    });
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    incrementMetric("pos_http_request_duration_bucket_total", { method: req.method, route, bucket: durationMs < 100 ? "lt100" : durationMs < 500 ? "lt500" : "gte500" });
    if (res.statusCode >= 400) incrementMetric("pos_http_request_errors_total", { method: req.method, route, status });
    const domain = domainForRoute(route);
    if (domain) incrementMetric(`pos_${domain}_outcomes_total`, { outcome });
  });
  next();
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    httpMetrics(req, res, next);
  }
}
