import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  receiptEmailSchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { fail, statusFor } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { ManagerApprovalPolicyService } from "../../auth/nest/manager-approval-policy.service";
import { SalesService } from "./sales.service";
import type { DbPort } from "../../common/db.port";
import { ApiTokenGuard } from "../../apitokens/api-token.guard";
import { idemKey, rid } from "./sales.controller.shared";

@Controller("api/v1")
@UseGuards(ApiTokenGuard, SessionGuard)
export class ReceiptsController {
  constructor(
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ManagerApprovalPolicyService) private readonly approvalPolicy: ManagerApprovalPolicyService,
    @Inject("DbPort") private readonly db: DbPort,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }
@Get("receipts/:saleId")
  async receipt(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
  ): Promise<void> {
    try {
      res.json(await this.sales.receiptData(req.auth!.businessId, saleId));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt fetch failed", req);
    }
  }

  // FR-RECEIPT-01: downloadable receipt (plain text).

@Get("receipts/:saleId/download")
  async receiptDownload(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
  ): Promise<void> {
    try {
      const { filename, text } = await this.sales.downloadReceipt(req.auth!.businessId, saleId);
      res.status(200)
        .set("Content-Type", "text/plain; charset=utf-8")
        .set("Content-Disposition", `attachment; filename="${filename}"`)
        .send(text);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt download failed", req);
    }
  }

  // FR-RECEIPT-01: mint a short-lived public share link for the receipt.

@Post("receipts/:saleId/share")
  @UseGuards(CsrfGuard)
  async receiptShare(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      const out = await this.sales.createShareToken(auth.businessId, auth.userId, rid(req), saleId);
      res.status(201).json(out);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt share failed", req);
    }
  }

@Post("receipts/:saleId/email")
  @UseGuards(CsrfGuard)
  async receiptEmail(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = receiptEmailSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid receipt email recipient", req);
      return;
    }
    try {
      const auth = req.auth!;
      const out = await this.sales.sendReceiptEmail(
        auth.businessId,
        auth.userId,
        rid(req),
        saleId,
        parsed.data.to,
        key,
      );
      res.status(out.replayed ? 200 : 201).json(out);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt email delivery failed", req);
    }
  }

@Get("receipts/:saleId/deliveries")
  async receiptDeliveries(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
  ): Promise<void> {
    try {
      res.status(200).json(await this.sales.listReceiptDeliveries(req.auth!.businessId, saleId));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt delivery history failed", req);
    }
  }
}
