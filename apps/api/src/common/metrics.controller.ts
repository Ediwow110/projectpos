import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { renderMetrics } from "./metrics";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// §14.2: the metrics families the incident playbooks reference, exposed in
// Prometheus text format. Bearer-gated by METRICS_TOKEN; disabled (403)
// while no token is configured so counters never leak publicly by accident.
@Controller("api/v1")
export class MetricsController {
  @Get("metrics")
  metrics(@Req() req: Request, @Res() res: Response): void {
    const expected = process.env["METRICS_TOKEN"] ?? "";
    const header = req.headers["authorization"];
    const provided = typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (expected.length === 0 || !safeEqual(expected, provided)) {
      res.status(403).json({ code: "FORBIDDEN", message: "Metrics token required" });
      return;
    }
    res.status(200)
      .set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
      .send(renderMetrics());
  }
}
