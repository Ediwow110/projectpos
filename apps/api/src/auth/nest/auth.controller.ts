import { Body, Controller, Delete, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  activeBusinessSchema,
  confirmPasswordSchema,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerSchema,
  verificationResendSchema,
  verifyEmailSchema,
} from "@pos/validation";
import { hashToken } from "../sessions";
import { issueCsrfToken } from "../csrf";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { createRateLimiter } from "../../common/rate-limit";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import {
  HUMAN_VERIFICATION_PORT,
  type HumanVerificationPort,
} from "../../common/human-verification";
import { AuthService } from "./auth.service";

export const RESET_REQUEST_LIMIT = 1;
export const RESET_REQUEST_WINDOW_MS = 60_000;
const resetLimiter = createRateLimiter(RESET_REQUEST_LIMIT, RESET_REQUEST_WINDOW_MS);
const verificationLimiter = createRateLimiter(5, 60_000);
const defaultRegistrationLimit = (process.env["NODE_ENV"] ?? "development") === "production" ? 10 : 1000;
const registrationLimit = Number(process.env["REGISTRATION_RATE_LIMIT"] ?? defaultRegistrationLimit);
const registrationLimiter = createRateLimiter(
  Number.isInteger(registrationLimit) && registrationLimit > 0 ? registrationLimit : 10,
  60_000,
);
// Production keeps the 5/min login brake. The limiter counts every attempt from
// an IP — successful ones included — so a dev machine or an e2e run that signs
// in many disposable accounts over loopback spends the entire budget before it
// reaches the flows under test. dev-local.mjs and playwright.config.ts raise
// LOGIN_RATE_LIMIT for exactly that reason; production leaves it unset.
const loginLimit = Number(process.env["LOGIN_RATE_LIMIT"] ?? 5);
const loginLimiter = createRateLimiter(
  Number.isInteger(loginLimit) && loginLimit > 0 ? loginLimit : 5,
  60_000,
);

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

export function cookieOpts(req: Request): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  const secure =
    (process.env["NODE_ENV"] ?? "development") === "production" || req.protocol === "https";
  return { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 * 1000 };
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(HUMAN_VERIFICATION_PORT) private readonly humanVerification: HumanVerificationPort,
  ) {}

  @Post("register")
  async register(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (await registrationLimiter.hit(`${req.ip ?? "unknown"}:register`)) {
      fail(res, 429, "RATE_LIMITED", "Too many registration attempts", req);
      return;
    }
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const code =
        first?.message === "AUTH_WEAK_PASSWORD" ? "AUTH_WEAK_PASSWORD" : "VALIDATION";
      fail(res, statusFor(code), code, "Invalid registration payload", req);
      return;
    }
    try {
      const out = await this.auth.register(parsed.data, {
        requestId: rid(req),
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"]?.toString() ?? null,
      });
      if (!out.verificationRequired) {
        res.cookie("pos_session", out.token, cookieOpts(req));
        res.cookie("pos_csrf", out.csrfToken, { ...cookieOpts(req), httpOnly: false });
      }
      res.status(201).json({
        user: out.user,
        business: out.business,
        ...(!out.verificationRequired ? { csrfToken: out.csrfToken } : {}),
        verificationRequired: out.verificationRequired,
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(
        res,
        statusFor(code, 400),
        code,
        code === "AUTH_EMAIL_TAKEN" ? "Email already registered" : "Registration failed",
        req,
      );
    }
  }

  @Post("login")
  async login(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (await loginLimiter.hit(`${req.ip ?? "unknown"}:login`)) {
      fail(res, 429, "RATE_LIMITED", "Too many attempts", req);
      return;
    }
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid login payload", req);
      return;
    }
    try {
      const out = await this.auth.login({ email: parsed.data.email, password: parsed.data.password }, {
        requestId: rid(req),
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"]?.toString() ?? null,
      }, parsed.data.deviceId);
      res.cookie("pos_session", out.token, cookieOpts(req));
      res.cookie("pos_csrf", out.csrfToken, { ...cookieOpts(req), httpOnly: false });
      res.json({
        userId: out.userId,
        businessId: out.businessId,
        csrfToken: out.csrfToken,
        onboardingRequired: out.onboardingRequired,
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : "AUTH_INVALID_CREDENTIALS";
      fail(res, statusFor(code, 401), code, "Invalid email or password", req);
    }
  }

  @Post("logout")
  @UseGuards(SessionGuard)
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token: string | undefined = req.cookies?.pos_session;
    if (token) await this.auth.logout(hashToken(token), rid(req));
    res.clearCookie("pos_session", { path: "/" });
    res.clearCookie("pos_csrf", { path: "/" });
    res.json({ ok: true });
  }

  @Get("sessions")
  @UseGuards(SessionGuard)
  async sessions(@Req() req: Request, @Res() res: Response): Promise<void> {
    const auth = req.auth!;
    const sessions = await this.auth.listSessions(auth.userId);
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        businessId: s.businessId,
        expiresAt: s.expiresAt.toISOString(),
        current: s.id === auth.sessionId,
      })),
    });
  }

  @Get("businesses")
  @UseGuards(SessionGuard)
  async businesses(@Req() req: Request, @Res() res: Response): Promise<void> {
    const auth = req.auth!;
    res.json({ items: await this.auth.listBusinesses(auth.userId, auth.businessId) });
  }

  @Delete("sessions/:id")
  @UseGuards(SessionGuard, CsrfGuard)
  async revoke(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    const auth = req.auth!;
    const revoked = await this.auth.revokeSession(auth.userId, id);
    if (!revoked) {
      fail(res, 404, "NOT_FOUND", "Session not found", req);
      return;
    }
    res.json({ ok: true });
  }

  @Post("password-reset/request")
  async resetRequest(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (await resetLimiter.hit(`${req.ip ?? "unknown"}:reset`)) {
      fail(res, 429, "RATE_LIMITED", "Too many attempts", req);
      return;
    }
    const parsed = passwordResetRequestSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid payload", req);
      return;
    }
    await this.auth.requestReset(parsed.data.email, {
      requestId: rid(req),
      ip: req.ip ?? null,
    });
    res.json({
      ok: true,
      message: "If the email exists, a reset link was issued.",
    });
  }

  @Post("verify-email/resend")
  async resendVerification(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (await verificationLimiter.hit(`${req.ip ?? "unknown"}:verify-email`)) {
      fail(res, 429, "RATE_LIMITED", "Too many attempts", req);
      return;
    }
    const parsed = verificationResendSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid payload", req);
      return;
    }
    if (this.humanVerification.enabled) {
      if (!parsed.data.captchaToken) {
        fail(res, 400, "CAPTCHA_REQUIRED", "Complete the human verification challenge", req);
        return;
      }
      const human = await this.humanVerification.verify({
        token: parsed.data.captchaToken,
        ip: req.ip ?? null,
        action: "verify_email_resend",
      });
      if (!human) {
        fail(res, 400, "CAPTCHA_FAILED", "Human verification failed", req);
        return;
      }
    }
    await this.auth.resendVerification(parsed.data.email, {
      requestId: rid(req),
      ip: req.ip ?? null,
    });
    res.json({
      ok: true,
      message: "If the account exists and still needs verification, a new link was issued.",
    });
  }

  @Get("verify-email/challenge")
  verificationChallenge(@Res() res: Response): void {
    res.json({
      enabled: this.humanVerification.enabled,
      ...(this.humanVerification.siteKey ? { siteKey: this.humanVerification.siteKey } : {}),
    });
  }

  @Post("password-reset/confirm")
  async resetConfirm(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = passwordResetConfirmSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const code = first?.message === "AUTH_WEAK_PASSWORD" ? "AUTH_WEAK_PASSWORD" : "VALIDATION";
      fail(res, statusFor(code), code, "Invalid reset payload", req);
      return;
    }
    try {
      await this.auth.confirmReset(parsed.data.token, parsed.data.newPassword, rid(req));
      res.json({ ok: true });
    } catch (e) {
      const code = e instanceof Error ? e.message : "AUTH_TOKEN_INVALID";
      fail(res, statusFor(code), code, "Reset failed", req);
    }
  }

  @Post("verify-email")
  async verifyEmail(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = verifyEmailSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid verification payload", req);
      return;
    }
    try {
      await this.auth.verifyEmail(parsed.data.token);
      res.json({ verified: true });
    } catch {
      fail(res, 400, "VALIDATION", "Email verification failed", req);
    }
  }

  @Post("active-business")
  @UseGuards(SessionGuard, CsrfGuard)
  async activeBusiness(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = activeBusinessSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid payload", req);
      return;
    }
    const auth = req.auth!;
    try {
      await this.auth.switchBusiness(auth.userId, parsed.data.businessId, auth.sessionId, rid(req));
      res.json({ ok: true, businessId: parsed.data.businessId });
    } catch (e) {
      const code = e instanceof Error ? e.message : "TENANT_MISMATCH";
      fail(res, statusFor(code, 403), code, "Cannot switch business", req);
    }
  }

  @Post("confirm-password")
  @UseGuards(SessionGuard, CsrfGuard)
  async confirmPassword(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = confirmPasswordSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid payload", req);
      return;
    }
    const auth = req.auth!;
    if (!(await this.auth.confirmPassword(auth.userId, auth.sessionId, parsed.data.password))) {
      fail(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid password", req);
      return;
    }
    res.json({ ok: true, reAuthenticatedAt: new Date().toISOString() });
  }

  @Get("csrf")
  async csrf(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = issueCsrfToken();
    res.cookie("pos_csrf", token, { ...cookieOpts(req), httpOnly: false });
    res.json({ csrfToken: token });
  }
}
