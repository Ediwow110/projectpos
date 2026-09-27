import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  customerCreateSchema,
  customerSearchSchema,
  customerUpdateSchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { CustomerService } from "./customer.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

const MANAGE_ROLES = new Set(["owner", "manager"]);

@Controller("api/v1")
@UseGuards(SessionGuard)
export class CustomerController {
  constructor(
    @Inject(CustomerService) private readonly customers: CustomerService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get("customers")
  async list(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = customerSearchSchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid customer query", req);
      return;
    }
    try {
      res.status(200).json(
        await this.customers.listCustomers(req.auth!.businessId, {
          q: parsed.data.q,
          active: parsed.data.active,
          page: parsed.data.page,
          pageSize: parsed.data.pageSize,
        }),
      );
    } catch (e) {
      failFromError(res, e, "Customer fetch failed", req);
    }
  }

  @Post("customers")
  @UseGuards(CsrfGuard)
  async create(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = customerCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid customer payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.customers.createCustomer(auth.businessId, auth.userId, rid(req), {
          name: parsed.data.name,
          phone: parsed.data.phone,
          email: parsed.data.email,
          address: parsed.data.address,
          notes: parsed.data.notes,
        }),
      );
    } catch (e) {
      failFromError(res, e, "Customer creation failed", req);
    }
  }

  @Get("customers/:id")
  async detail(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      res.status(200).json(await this.customers.getCustomer(auth.businessId, id, auth.role));
    } catch (e) {
      failFromError(res, e, "Customer fetch failed", req);
    }
  }

  @Patch("customers/:id")
  @UseGuards(CsrfGuard)
  async update(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!MANAGE_ROLES.has(req.auth!.role)) {
      fail(res, 403, "FORBIDDEN", "Customer edit requires owner or manager role", req);
      return;
    }
    const parsed = customerUpdateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid customer payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const { isActive, ...rest } = parsed.data;
      if (isActive === false) {
        res.status(200).json(await this.customers.archiveCustomer(auth.businessId, auth.userId, rid(req), id, auth.role));
        return;
      }
      res.status(200).json(
        await this.customers.updateCustomer(auth.businessId, auth.userId, rid(req), id, { ...rest }, auth.role),
      );
    } catch (e) {
      failFromError(res, e, "Customer update failed", req);
    }
  }
}
