import { Controller, Get, Inject, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  productsReportQuerySchema,
  reportsQuerySchema,
  salesReportQuerySchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { ReportingService } from "./reporting.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class ReportingController {
  constructor(
    @Inject(ReportingService) private readonly reports: ReportingService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }

  @Get("dashboard/overview")
  async overview(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = reportsQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid dashboard query", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.reports.getOverview(auth.businessId, {
          dateFrom: parsed.data.dateFrom,
          dateTo: parsed.data.dateTo,
          compare: parsed.data.compare,
          registerId: parsed.data.registerId,
        }, auth.role, this.perms(req)),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Dashboard fetch failed", req);
    }
  }

  @Get("reports/sales")
  async sales(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = salesReportQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid sales report query", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.reports.getSalesReport(auth.businessId, {
          dateFrom: parsed.data.dateFrom,
          dateTo: parsed.data.dateTo,
          compare: parsed.data.compare,
          registerId: parsed.data.registerId,
          granularity: parsed.data.granularity,
        }, auth.role, this.perms(req)),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sales report fetch failed", req);
    }
  }

  @Get("reports/products")
  async products(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = productsReportQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid products report query", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.reports.getProductsReport(auth.businessId, {
          dateFrom: parsed.data.dateFrom,
          dateTo: parsed.data.dateTo,
          compare: parsed.data.compare,
          registerId: parsed.data.registerId,
          tab: parsed.data.tab,
          limit: parsed.data.limit,
        }, auth.role, this.perms(req)),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Products report fetch failed", req);
    }
  }

  @Get("reports/inventory")
  async inventory(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      res.status(200).json(await this.reports.getInventoryReport(req.auth!.businessId));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Inventory report fetch failed", req);
    }
  }

  @Get("reports/payments")
  async payments(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = reportsQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid payments report query", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.reports.getPaymentsReport(auth.businessId, {
          dateFrom: parsed.data.dateFrom,
          dateTo: parsed.data.dateTo,
          compare: parsed.data.compare,
          registerId: parsed.data.registerId,
        }, auth.role, this.perms(req)),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Payments report fetch failed", req);
    }
  }

  @Get("reports/cash")
  async cash(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = reportsQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid cash report query", req);
      return;
    }
    try {
      res.status(200).json(
        await this.reports.getCashReport(req.auth!.businessId, {
          dateFrom: parsed.data.dateFrom,
          dateTo: parsed.data.dateTo,
          compare: parsed.data.compare,
          registerId: parsed.data.registerId,
        }),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Cash report fetch failed", req);
    }
  }

  @Get("reports/customers")
  async customers(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = reportsQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid customers report query", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.reports.getCustomersReport(auth.businessId, {
          dateFrom: parsed.data.dateFrom,
          dateTo: parsed.data.dateTo,
          compare: parsed.data.compare,
        }, auth.role),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Customers report fetch failed", req);
    }
  }

  @Get("reports/cashiers")
  async cashiers(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = reportsQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid cashiers report query", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.reports.getCashiersReport(auth.businessId, {
          dateFrom: parsed.data.dateFrom,
          dateTo: parsed.data.dateTo,
          compare: parsed.data.compare,
          registerId: parsed.data.registerId,
        }, auth.role),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Cashiers report fetch failed", req);
    }
  }
}
