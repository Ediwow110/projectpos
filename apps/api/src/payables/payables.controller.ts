import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { supplierBillCreateSchema, supplierBillPostSchema, supplierCreditApplySchema, supplierPaymentCreateSchema } from "@pos/validation";
import { AuthService } from "../auth/nest/auth.service";
import { CsrfGuard } from "../common/csrf.guard";
import type { DbPort } from "../common/db.port";
import { fail, failFromError } from "../common/http-helpers";
import { SessionGuard } from "../common/session.guard";
import { getCorrelationId } from "../correlation";
import { PayablesService } from "./payables.service";

function requestId(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return getCorrelationId(headers);
}

@Controller("api/v1/payables")
@UseGuards(SessionGuard)
export class PayablesController {
  private readonly service: PayablesService;
  constructor(@Inject("DbPort") private readonly db: DbPort, @Inject(AuthService) private readonly auth: AuthService) { this.service = new PayablesService(db); }
  private allowed(req: Request, permission: string): boolean { return this.auth.rolePermissions(req.auth!.role).includes(permission); }

  @Get("bills/:id")
  async billDetail(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    if (!this.allowed(req, "payables.read")) return fail(res, 403, "FORBIDDEN", "Payables read permission required", req);
    try {
      const businessId = req.auth!.businessId;
      const bill = await this.db.findSupplierBill(id, businessId);
      if (!bill) return fail(res, 404, "NOT_FOUND", "Supplier bill not found", req);
      const [supplier, allocations, payments, credits] = await Promise.all([
        this.db.findSupplierById(bill.supplierId, businessId),
        this.db.listSupplierBillAllocations(bill.id, businessId),
        this.db.listSupplierPayments(bill.id, businessId),
        this.db.listSupplierCredits(businessId, bill.supplierId),
      ]);
      const appliedCredits = credits.filter((credit) => credit.billId === bill.id && ["POSTED", "APPLIED"].includes(credit.status));
      const creditMinor = appliedCredits.reduce((sum, credit) => sum + credit.amountMinor, 0);
      const grossMinor = bill.invoiceAmountMinor + bill.nonStockChargeMinor;
      res.status(200).json({
        bill: { ...bill, supplierName: supplier?.name ?? "Supplier", creditMinor, openBalanceMinor: Math.max(0, grossMinor - bill.paidMinor - creditMinor) },
        allocations,
        payments,
        credits: appliedCredits,
      });
    } catch (error) { failFromError(res, error, "Supplier bill detail could not be loaded", req); }
  }

  @Get("credits")
  async listCredits(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.allowed(req, "payables.read")) return fail(res, 403, "FORBIDDEN", "Payables read permission required", req);
    try {
      const businessId = req.auth!.businessId;
      res.status(200).json({ items: await this.db.listUnappliedSupplierCredits(businessId) });
    } catch (error) { failFromError(res, error, "Supplier credits could not be loaded", req); }
  }

  @Post("credits/:id/apply")
  @UseGuards(CsrfGuard)
  async applyCredit(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    if (!this.allowed(req, "payables.write")) return fail(res, 403, "FORBIDDEN", "Payables write permission required", req);
    const parsed = supplierCreditApplySchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid supplier credit application", req);
    try { res.status(200).json(await this.service.applyCredit(req.auth!.businessId, req.auth!.userId, requestId(req), id, parsed.data, this.auth.rolePermissions(req.auth!.role))); }
    catch (error) { failFromError(res, error, "Supplier credit could not be applied", req); }
  }

  @Get("bills")
  async listBills(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.allowed(req, "payables.read")) return fail(res, 403, "FORBIDDEN", "Payables read permission required", req);
    try {
      const businessId = req.auth!.businessId;
      const bills = await this.db.listSupplierBills(businessId);
      const creditsBySupplier = new Map<string, Awaited<ReturnType<DbPort["listSupplierCredits"]>>>();
      const items = await Promise.all(bills.map(async (bill) => {
        let credits = creditsBySupplier.get(bill.supplierId);
        if (!credits) { credits = await this.db.listSupplierCredits(businessId, bill.supplierId); creditsBySupplier.set(bill.supplierId, credits); }
        const supplier = await this.db.findSupplierById(bill.supplierId, businessId);
        const creditMinor = credits.filter((credit) => credit.billId === bill.id && ["POSTED", "APPLIED"].includes(credit.status)).reduce((sum, credit) => sum + credit.amountMinor, 0);
        const grossMinor = bill.invoiceAmountMinor + bill.nonStockChargeMinor;
        return { ...bill, supplierName: supplier?.name ?? "Supplier", creditMinor, openBalanceMinor: Math.max(0, grossMinor - bill.paidMinor - creditMinor) };
      }));
      res.status(200).json({ items });
    }
    catch (error) { failFromError(res, error, "Supplier bills could not be loaded", req); }
  }

  @Post("bills")
  @UseGuards(CsrfGuard)
  async createBill(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (!this.allowed(req, "payables.write")) return fail(res, 403, "FORBIDDEN", "Payables write permission required", req);
    const parsed = supplierBillCreateSchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid supplier bill", req);
    const { idempotencyKey, ...payload } = parsed.data;
    const input = { ...payload, invoiceDate: new Date(payload.invoiceDate), dueDate: payload.dueDate ? new Date(payload.dueDate) : null };
    try {
      const out = await this.service.createDraft(req.auth!.businessId, req.auth!.userId, requestId(req), idempotencyKey, input, this.auth.rolePermissions(req.auth!.role));
      res.status(out.replayed ? 200 : 201).json(out);
    } catch (error) { failFromError(res, error, "Supplier bill could not be created", req); }
  }

  @Post("bills/:id/post")
  @UseGuards(CsrfGuard)
  async postBill(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    if (!this.allowed(req, "payables.write")) return fail(res, 403, "FORBIDDEN", "Payables write permission required", req);
    const parsed = supplierBillPostSchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid supplier bill version", req);
    try { res.status(200).json(await this.service.postDraft(req.auth!.businessId, req.auth!.userId, requestId(req), id, parsed.data.expectedVersion, this.auth.rolePermissions(req.auth!.role))); }
    catch (error) { failFromError(res, error, "Supplier bill could not be posted", req); }
  }

  @Post("bills/:id/payments")
  @UseGuards(CsrfGuard)
  async payBill(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    if (!this.allowed(req, "payables.pay")) return fail(res, 403, "FORBIDDEN", "Payables payment permission required", req);
    const parsed = supplierPaymentCreateSchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid supplier payment", req);
    const { idempotencyKey, ...payload } = parsed.data;
    try {
      const out = await this.service.payBill(req.auth!.businessId, req.auth!.userId, requestId(req), id, idempotencyKey, { ...payload, paidAt: new Date(payload.paidAt) }, this.auth.rolePermissions(req.auth!.role));
      res.status(out.replayed ? 200 : 201).json(out);
    } catch (error) { failFromError(res, error, "Supplier payment could not be recorded", req); }
  }
}
