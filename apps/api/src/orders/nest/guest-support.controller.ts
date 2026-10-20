import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { guestSupportCaseSchema, guestSupportStatusSchema, platformOwnerConsentSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { FirstPartyOriginGuard } from "../../common/first-party-origin.guard";
import { fail, failFromError } from "../../common/http-helpers";
import { createRateLimiter } from "../../common/rate-limit";
import { getCorrelationId } from "../../correlation";
import { AuthService } from "../../auth/nest/auth.service";
import { isPlatformKey } from "../../billing/platform-key";
import { GuestSupportService, PlatformConsentService } from "../guest-support.service";

const guestLimiter = createRateLimiter(10, 60_000);
const ownerConsentLimiter = createRateLimiter(5, 60_000);

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  return getCorrelationId(headers);
}

@Controller("api/v1/public/support")
export class GuestSupportPublicController {
  constructor(@Inject(GuestSupportService) private readonly service: GuestSupportService) {}

  @Post("cases")
  @UseGuards(FirstPartyOriginGuard)
  async submit(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = guestSupportCaseSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid support request", req); return; }
    const rawKey = req.headers["idempotency-key"];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key || key.length > 128) { fail(res, 400, "VALIDATION", "Idempotency-Key required", req); return; }
    if (await guestLimiter.hit(`support:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`)) {
      fail(res, 429, "RATE_LIMITED", "Too many support submissions", req); return;
    }
    try {
      const result = await this.service.submit(parsed.data, key, rid(req));
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) { failFromError(res, error, "Support request unavailable", req); }
  }

  @Post("history")
  @UseGuards(FirstPartyOriginGuard)
  async history(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = guestSupportStatusSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid status token", req); return; }
    if (await guestLimiter.hit(`support-history:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`)) {
      fail(res, 429, "RATE_LIMITED", "Too many support lookups", req); return;
    }
    try { res.json({ items: await this.service.guestHistory(parsed.data.statusToken) }); }
    catch (error) { failFromError(res, error, "Support history unavailable", req); }
  }
}

@Controller("api/v1/admin/support")
@UseGuards(SessionGuard)
export class OwnerSupportController {
  constructor(
    @Inject(GuestSupportService) private readonly cases: GuestSupportService,
    @Inject(PlatformConsentService) private readonly consents: PlatformConsentService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private owner(req: Request, res: Response): boolean {
    if (req.auth?.role !== "owner") { fail(res, 403, "FORBIDDEN", "Owner access required", req); return false; }
    return true;
  }

  @Get("cases")
  async listCases(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.owner(req, res)) return;
    try { res.json({ items: await this.cases.listForBusiness(req.auth!.businessId) }); }
    catch (error) { failFromError(res, error, "Support cases unavailable", req); }
  }

  @Post("cases/:id/close")
  @UseGuards(CsrfGuard)
  async closeCase(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    if (!this.owner(req, res)) return;
    try { res.json(await this.cases.close(req.auth!.businessId, req.auth!.userId, id, rid(req))); }
    catch (error) { failFromError(res, error, "Support case could not be closed", req); }
  }

  @Get("consents")
  async listConsents(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.owner(req, res)) return;
    try { res.json({ items: await this.consents.list(req.auth!.businessId) }); }
    catch (error) { failFromError(res, error, "Support consents unavailable", req); }
  }

  @Post("consents")
  @UseGuards(CsrfGuard)
  async consent(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (!this.owner(req, res)) return;
    const parsed = platformOwnerConsentSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid consent request", req); return; }
    if (await ownerConsentLimiter.hit(`consent:${req.auth!.userId}:${req.ip ?? "unknown"}`)) {
      fail(res, 429, "RATE_LIMITED", "Too many owner confirmations", req); return;
    }
    try {
      if (!(await this.auth.checkPassword(req.auth!.userId, parsed.data.password))) throw new Error("AUTH_INVALID_CREDENTIALS");
      res.status(201).json(await this.consents.issue(req.auth!.businessId, req.auth!.userId, parsed.data.purpose, parsed.data.ttlMinutes, rid(req)));
    } catch (error) { failFromError(res, error, "Consent could not be issued", req); }
  }

  @Post("consents/:id/revoke")
  @UseGuards(CsrfGuard)
  async revoke(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    if (!this.owner(req, res)) return;
    try { await this.consents.revoke(req.auth!.businessId, req.auth!.userId, id, rid(req)); res.json({ revoked: true }); }
    catch (error) { failFromError(res, error, "Consent could not be revoked", req); }
  }
}

@Controller("api/v1/platform/diagnostics")
export class PlatformDiagnosticsController {
  constructor(@Inject(PlatformConsentService) private readonly consents: PlatformConsentService) {}

  @Get("businesses/:id")
  async get(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    const provided = req.headers["x-platform-key"];
    const key = Array.isArray(provided) ? provided[0] : provided;
    if (!isPlatformKey(key)) { fail(res, 403, "FORBIDDEN", "Operator authentication required", req); return; }
    const consentHeader = req.headers["x-owner-consent"];
    const consentToken = Array.isArray(consentHeader) ? consentHeader[0] : consentHeader;
    try { res.json(await this.consents.diagnostics(id, consentToken ?? "", rid(req))); }
    catch (error) { failFromError(res, error, "Consent missing, revoked or expired", req); }
  }
}
