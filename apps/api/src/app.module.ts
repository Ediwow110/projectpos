import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { RequestHandler } from "express";
import cookieParser from "cookie-parser";
import { AuthController } from "./auth/nest/auth.controller";
import { AuthService } from "./auth/nest/auth.service";
import { TenantController } from "./tenant/nest/tenant.controller";
import { TenantService } from "./tenant/nest/tenant.service";
import { BusinessController } from "./business/nest/business.controller";
import { BusinessService } from "./business/nest/business.service";
import { CatalogController } from "./catalog/nest/catalog.controller";
import { InventoryController } from "./inventory/nest/inventory.controller";
import { SalesController } from "./sales/nest/sales.controller";
import { ShiftController } from "./shifts/nest/shift.controller";
import { CustomerController } from "./customers/nest/customer.controller";
import { ExpenseController } from "./expenses/nest/expense.controller";
import { RefundController } from "./refunds/nest/refund.controller";
import { ReportingController } from "./reports/nest/reporting.controller";
import { BranchController } from "./branches/nest/branch.controller";
import { TransferController } from "./transfers/nest/transfer.controller";
import { SyncController } from "./sync/nest/sync.controller";
import { DeviceController } from "./devices/nest/device.controller";
import { PlatformController } from "./billing/nest/platform.controller";
import { BillingController } from "./billing/nest/billing.controller";
import { ExportController } from "./exports/nest/export.controller";
import { PrintController } from "./print/nest/print.controller";
import { DisplayController } from "./display/nest/display.controller";
import { CatalogService } from "./catalog/nest/catalog.service";
import { InventoryService } from "./inventory/nest/inventory.service";
import { SalesService } from "./sales/nest/sales.service";
import { ShiftService } from "./shifts/nest/shift.service";
import { CustomerService } from "./customers/nest/customer.service";
import { ExpenseService } from "./expenses/nest/expense.service";
import { RefundService } from "./refunds/nest/refund.service";
import { ReportingService } from "./reports/nest/reporting.service";
import { BranchService } from "./branches/nest/branch.service";
import { TransferService } from "./transfers/nest/transfer.service";
import { SyncService } from "./sync/nest/sync.service";
import { DeviceService } from "./devices/nest/device.service";
import { BillingService } from "./billing/nest/billing.service";
import { ExportService } from "./exports/nest/export.service";
import { PrintService } from "./print/nest/print.service";
import { DisplayService } from "./display/nest/display.service";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { SecurityHeadersMiddleware, securityHeaders } from "./common/security-headers.middleware";
import { SessionGuard } from "./common/session.guard";
import { CsrfGuard } from "./common/csrf.guard";
import { AuthErrorFilter } from "./common/auth-error.filter";
import type { DbPort } from "./common/db.port";
import { createMemoryDb } from "./common/memory.db";

@Module({
    controllers: [AuthController, TenantController, BusinessController, CatalogController, InventoryController, SalesController, ShiftController, CustomerController, ExpenseController, RefundController, ReportingController, BranchController, TransferController, SyncController, DeviceController, PlatformController, BillingController, ExportController, PrintController, DisplayController],
  providers: [
    AuthService,
    TenantService,
    BusinessService,
    CatalogService,
    InventoryService,
    SalesService,
    ShiftService,
    CustomerService,
    ExpenseService,
    RefundService,
    ReportingService,
    BranchService,
    TransferService,
    SyncService,
    DeviceService,
    BillingService,
    ExportService,
    PrintService,
    DisplayService,
    SessionGuard,
    CsrfGuard,
    // Standalone boot store: single-process ephemeral memory database.
    // Correct for local dev and E2E; a Postgres-backed DbPort is a
    // dated follow-up required before production launch (see audit doc).
    { provide: "DbPort", useFactory: () => createMemoryDb() },
    { provide: APP_FILTER, useClass: AuthErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, SecurityHeadersMiddleware).forRoutes("*");
  }
}

export async function createTestApp(): Promise<INestApplication> {
  const db: DbPort = createMemoryDb();
  const moduleRef = await Test.createTestingModule({
  controllers: [AuthController, TenantController, BusinessController, CatalogController, InventoryController, SalesController, ShiftController, CustomerController, ExpenseController, RefundController, ReportingController, BranchController, TransferController, SyncController, DeviceController, PlatformController, BillingController, ExportController, PrintController, DisplayController],
    providers: [
      { provide: "DbPort", useValue: db },
      { provide: AuthService, useFactory: (d: DbPort) => new AuthService(d), inject: ["DbPort"] },
      {
        provide: TenantService,
        useFactory: (d: DbPort) => new TenantService(d),
        inject: ["DbPort"],
      },
      {
        provide: BusinessService,
        useFactory: (d: DbPort) => new BusinessService(d),
        inject: ["DbPort"],
      },
      {
        provide: CatalogService,
        useFactory: (d: DbPort) => new CatalogService(d),
        inject: ["DbPort"],
      },
      {
        provide: InventoryService,
        useFactory: (d: DbPort) => new InventoryService(d),
        inject: ["DbPort"],
      },
      {
        provide: SalesService,
        useFactory: (d: DbPort) => new SalesService(d),
        inject: ["DbPort"],
      },
      {
        provide: ShiftService,
        useFactory: (d: DbPort) => new ShiftService(d),
        inject: ["DbPort"],
      },
      {
        provide: CustomerService,
        useFactory: (d: DbPort) => new CustomerService(d),
        inject: ["DbPort"],
      },
      {
        provide: ExpenseService,
        useFactory: (d: DbPort) => new ExpenseService(d),
        inject: ["DbPort"],
      },
      {
        provide: RefundService,
        useFactory: (d: DbPort) => new RefundService(d),
        inject: ["DbPort"],
      },
      {
        provide: ReportingService,
        useFactory: (d: DbPort) => new ReportingService(d),
        inject: ["DbPort"],
      },
      {
        provide: BranchService,
        useFactory: (d: DbPort) => new BranchService(d),
        inject: ["DbPort"],
      },
      {
        provide: TransferService,
        useFactory: (d: DbPort) => new TransferService(d),
        inject: ["DbPort"],
      },
      {
        provide: SyncService,
        useFactory: (d: DbPort) => new SyncService(d),
        inject: ["DbPort"],
      },
      {
        provide: DeviceService,
        useFactory: (d: DbPort) => new DeviceService(d),
        inject: ["DbPort"],
      },
      {
        provide: BillingService,
        useFactory: (d: DbPort) => new BillingService(d),
        inject: ["DbPort"],
      },
      {
        provide: ExportService,
        useFactory: (d: DbPort) => new ExportService(d),
        inject: ["DbPort"],
      },
      {
        provide: PrintService,
        useFactory: (d: DbPort) => new PrintService(d),
        inject: ["DbPort"],
      },
      {
        provide: DisplayService,
        useFactory: (d: DbPort) => new DisplayService(d),
        inject: ["DbPort"],
      },
      {
        provide: SessionGuard,
        useFactory: (d: DbPort) => new SessionGuard(d),
        inject: ["DbPort"],
      },
      CsrfGuard,
      { provide: APP_FILTER, useClass: AuthErrorFilter },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser() as RequestHandler);
  // createTestApp bypasses AppModule.configure(), so apply shared
  // middleware explicitly here (production covers it via configure()).
  app.use(securityHeaders as RequestHandler);
  app.useLogger(false);
  await app.init();
  return app;
}
