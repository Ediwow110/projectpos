import { Controller, Get, Inject, Optional, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { resolveBuildIdentity } from "./build-identity";
import { fail } from "./http-helpers";
import type { PgContext } from "./pg/context";

// Public probes for load balancers and container orchestrators. Unlike
// api/v1/health (a session-scoped check), these need no cookies and return
// nothing but status, so they are safe to expose unauthenticated.
@Controller()
export class HealthController {
  // Absent when the runtime store is the in-memory database (local dev and
  // tests); readiness then reflects the process itself.
  constructor(@Optional() @Inject("PgContext") private readonly pg: PgContext | null) {}

  @Get("healthz")
  live(@Res() res: Response): void {
    res.status(200).json({ ok: true });
  }

  // Which build is actually serving requests. A deploy state on a hosting
  // dashboard is not something an auditor can read from the product, and
  // the 2026-10-20 frontend audit had to reconstruct the running build
  // from outside. This reports the commit, branch, service and public
  // hostname of the current deploy, and reports null for anything the
  // platform does not publish rather than a plausible-looking value.
  @Get("version")
  version(@Res() res: Response): void {
    res.status(200).json({ ok: true, build: resolveBuildIdentity() });
  }

  @Get("readyz")
  async ready(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (this.pg) {
      try {
        const client = await this.pg.client();
        try {
          await client.query("SELECT 1");
        } finally {
          if (this.pg.owns()) client.release();
        }
      } catch {
        fail(res, 503, "NOT_READY", "Store unavailable", req);
        return;
      }
    }
    res.status(200).json({ ok: true });
  }
}
