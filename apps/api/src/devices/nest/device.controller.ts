import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { deviceEnrollSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { DeviceService } from "./device.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

function idemKey(req: Request): string | null {
  const raw = req.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.trim() === "") return null;
  return key;
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class DeviceController {
  constructor(
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get("devices")
  async listDevices(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const auth = req.auth!;
      res.status(200).json({ items: await this.devices.listDevices(auth.businessId, auth.userId, auth.role) });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Device fetch failed", req);
    }
  }

  @Post("devices")
  @UseGuards(CsrfGuard)
  async enrollDevice(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = deviceEnrollSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid device payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.devices.enrollDevice(auth.businessId, auth.userId, rid(req), {
          label: parsed.data.label,
        }),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Device enrollment failed", req);
    }
  }

  @Post("devices/:id/revoke")
  @UseGuards(CsrfGuard)
  async revokeDevice(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.devices.revokeDevice(auth.businessId, auth.userId, rid(req), id, auth.role),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Device revoke failed", req);
    }
  }
}
