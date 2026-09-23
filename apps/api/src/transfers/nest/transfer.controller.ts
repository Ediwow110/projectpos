import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { transferCreateSchema, transferListSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { TransferService } from "./transfer.service";

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
export class TransferController {
  constructor(
    @Inject(TransferService) private readonly transfers: TransferService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }

  @Get("transfers")
  async listTransfers(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = transferListSchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid transfers query", req);
      return;
    }
    try {
      res.status(200).json(
        await this.transfers.listTransfers(req.auth!.businessId, {
          status: parsed.data.status,
          page: parsed.data.page,
          pageSize: parsed.data.pageSize,
        }),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Transfer fetch failed", req);
    }
  }

  @Post("transfers")
  @UseGuards(CsrfGuard)
  async createTransfer(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = transferCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid transfer payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.transfers.createTransfer(auth.businessId, auth.userId, rid(req), {
          fromBranchId: parsed.data.fromBranchId,
          toBranchId: parsed.data.toBranchId,
          lines: parsed.data.lines,
        }, this.perms(req)),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Transfer creation failed", req);
    }
  }

  @Get("transfers/:id")
  async getTransfer(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      res.status(200).json(await this.transfers.getTransfer(req.auth!.businessId, id));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Transfer fetch failed", req);
    }
  }

  private requireKey(req: Request, res: Response): string | null {
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return null;
    }
    return key;
  }

  @Post("transfers/:id/dispatch")
  @UseGuards(CsrfGuard)
  async dispatch(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    const key = this.requireKey(req, res);
    if (!key) return;
    try {
      const auth = req.auth!;
      const { transfer, replayed } = await this.transfers.dispatchTransfer(
        auth.businessId, auth.userId, rid(req), id, key, this.perms(req),
      );
      res.status(200).json({ transfer, replayed });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Transfer dispatch failed", req);
    }
  }

  @Post("transfers/:id/receive")
  @UseGuards(CsrfGuard)
  async receive(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    const key = this.requireKey(req, res);
    if (!key) return;
    try {
      const auth = req.auth!;
      const { transfer, replayed } = await this.transfers.receiveTransfer(
        auth.businessId, auth.userId, rid(req), id, key, this.perms(req),
      );
      res.status(200).json({ transfer, replayed });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Transfer receive failed", req);
    }
  }

  @Post("transfers/:id/cancel")
  @UseGuards(CsrfGuard)
  async cancel(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    const key = this.requireKey(req, res);
    if (!key) return;
    try {
      const auth = req.auth!;
      const { transfer, replayed } = await this.transfers.cancelTransfer(
        auth.businessId, auth.userId, rid(req), id, key, this.perms(req),
      );
      res.status(200).json({ transfer, replayed });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Transfer cancel failed", req);
    }
  }
}
