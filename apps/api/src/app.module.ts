import { MiddlewareConsumer, Module, type NestModule, Optional, Inject } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import cookieParser from "cookie-parser";
import { AuthController } from "./auth/nest/auth.controller";
import { ApprovalController } from "./auth/nest/approval.controller";
import { AuthService } from "./auth/nest/auth.service";
import { ManagerApprovalPolicyService } from "./auth/nest/manager-approval-policy.service";
import { TenantController } from "./tenant/nest/tenant.controller";
import { TenantService } from "./tenant/nest/tenant.service";
import { BusinessController } from "./business/nest/business.controller";
import { BusinessService } from "./business/nest/business.service";
import { CatalogController } from "./catalog/nest/catalog.controller";
import { ProductModelController } from "./catalog/nest/product-model.controller";
import { InventoryController } from "./inventory/nest/inventory.controller";
import { InventoryCountController } from "./inventory/nest/inventory-count.controller";
import { SalesController } from "./sales/nest/sales.controller";
import { PaymentsController } from "./sales/nest/payments.controller";
import { ReceiptsController } from "./sales/nest/receipts.controller";
import { ShiftController } from "./shifts/nest/shift.controller";
import { CustomerController } from "./customers/nest/customer.controller";
import { ExpenseController } from "./expenses/nest/expense.controller";
import { RefundController } from "./refunds/nest/refund.controller";
import { ReportingController } from "./reports/nest/reporting.controller";
import { BranchController } from "./branches/nest/branch.controller";
import { TransferController } from "./transfers/nest/transfer.controller";
import { SyncController } from "./sync/nest/sync.controller";
import { DeviceController } from "./devices/nest/device.controller";
import { ApiTokenController } from "./apitokens/nest/apitoken.controller";
import { PlatformController } from "./billing/nest/platform.controller";
import { BillingController } from "./billing/nest/billing.controller";
import { ExportController } from "./exports/nest/export.controller";
import { PrintController } from "./print/nest/print.controller";
import { DisplayController } from "./display/nest/display.controller";
import { MembershipController } from "./memberships/nest/membership.controller";
import { ReceiptShareController } from "./sales/nest/receipt-share.controller";
import { PayMongoController } from "./payments/paymongo.controller";
import { ProcurementController } from "./procurement/nest/procurement.controller";
import { ValueController } from "./value/value.controller";
import { CatalogService } from "./catalog/nest/catalog.service";
import { ProductModelService } from "./catalog/nest/product-model.service";
import { InventoryService } from "./inventory/nest/inventory.service";
import { InventoryCountService } from "./inventory/nest/inventory-count.service";
import { SalesService } from "./sales/nest/sales.service";
import { ShiftService } from "./shifts/nest/shift.service";
import { CustomerService } from "./customers/nest/customer.service";
import { ExpenseService } from "./expenses/nest/expense.service";
import { MembershipService } from "./memberships/nest/membership.service";
import { SupportGrantService } from "./billing/nest/support-grant.service";
import { ExchangeService } from "./refunds/nest/exchange.service";
import { RefundService } from "./refunds/nest/refund.service";
import { ReportingService } from "./reports/nest/reporting.service";
import { BranchService } from "./branches/nest/branch.service";
import { TransferService } from "./transfers/nest/transfer.service";
import { SyncService } from "./sync/nest/sync.service";
import { DeviceService } from "./devices/nest/device.service";
import { ApiTokenService } from "./apitokens/nest/apitoken.service";
import { BillingService } from "./billing/nest/billing.service";
import { ExportService } from "./exports/nest/export.service";
import { PrintService } from "./print/nest/print.service";
import { DisplayService } from "./display/nest/display.service";
import { ProcurementService } from "./procurement/nest/procurement.service";
import {
  createManagedPayMongoFromEnv,
  createPayMongoFromEnv,
  PAYMONGO_PORT,
  type PayMongoPort,
} from "./payments/paymongo";
import { HealthController } from "./common/health.controller";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { SecurityHeadersMiddleware, securityHeaders } from "./common/security-headers.middleware";
import { MetricsMiddleware, httpMetrics } from "./common/metrics.middleware";
import { MetricsController } from "./common/metrics.controller";
import { OrderController } from "./orders/nest/order.controller";
import { PublicOrderController } from "./orders/nest/public-order.controller";
import { OrderService } from "./orders/order-service";
import { OrderNotificationService } from "./orders/order-notification-service";
import { OrderExpiryService } from "./orders/order-expiry-service";
import { FirstPartyOriginGuard } from "./common/first-party-origin.guard";
import { SessionGuard } from "./common/session.guard";
import { CsrfGuard } from "./common/csrf.guard";
import {
  createHumanVerificationFromEnv,
  DISABLED_HUMAN_VERIFICATION,
  HUMAN_VERIFICATION_PORT,
  type HumanVerificationPort,
} from "./common/human-verification";
import { AuthErrorFilter } from "./common/auth-error.filter";
import type { DbPort } from "./common/db.port";
import { createMemoryDb } from "./common/memory.db";
import { PgContext } from "./common/pg/context";
import { PgDbPort } from "./common/pg/pg.db";
import { PgRateLimitBackend } from "./common/pg/pg-rate-limit";
import { setRateLimitBackend } from "./common/rate-limit";
import {
  createTransactionalEmailFromEnv,
  NOOP_TRANSACTIONAL_EMAIL,
  TRANSACTIONAL_EMAIL_PORT,
  type TransactionalEmailPort,
} from "./email/email.service";

function runtimeDatabaseUrl(): string | undefined {
  const url = process.env["DATABASE_URL"];
  if (!url && (process.env["NODE_ENV"] ?? "development") === "production") {
    throw new Error("ENV_MISSING_DATABASE_URL");
  }
  return url;
}

@Module({
    controllers: [HealthController, AuthController, ApprovalController, TenantController, BusinessController, ProductModelController, CatalogController, InventoryController, InventoryCountController, SalesController, PaymentsController, ReceiptsController, ShiftController, CustomerController, ExpenseController, RefundController, ReportingController, BranchController, TransferController, SyncController, DeviceController, PlatformController, BillingController, ExportController, PrintController, DisplayController, ApiTokenController, MembershipController, ReceiptShareController, PayMongoController, ProcurementController, ValueController, MetricsController, OrderController, PublicOrderController],
  providers: [
    {
      provide: HUMAN_VERIFICATION_PORT,
      useFactory: () => createHumanVerificationFromEnv(process.env),
    },
    {
      provide: PAYMONGO_PORT,
      useFactory: () => createManagedPayMongoFromEnv(process.env),
    },
    {
      provide: TRANSACTIONAL_EMAIL_PORT,
      useFactory: () => createTransactionalEmailFromEnv(process.env),
    },
    {
      provide: AuthService,
      useFactory: (d: DbPort, email: TransactionalEmailPort) => new AuthService(d, email),
      inject: ["DbPort", TRANSACTIONAL_EMAIL_PORT],
    },
    ManagerApprovalPolicyService,
    TenantService,
    BusinessService,
    CatalogService,
    ProductModelService,
    InventoryService,
    {
      provide: SalesService,
      useFactory: (d: DbPort, paymongo: PayMongoPort, email: TransactionalEmailPort) => new SalesService(d, paymongo, email),
      inject: ["DbPort", PAYMONGO_PORT, TRANSACTIONAL_EMAIL_PORT],
    },
    ShiftService,
    CustomerService,
    ExpenseService,
    MembershipService,
    SupportGrantService,
    ExchangeService,
    RefundService,
    ReportingService,
    BranchService,
    TransferService,
    SyncService,
    DeviceService,
    ApiTokenService,
    BillingService,
    ExportService,
    PrintService,
    DisplayService,
    ProcurementService,
    {
      provide: OrderService,
      useFactory: (d: DbPort, notifications: OrderNotificationService) => new OrderService(d, notifications),
      inject: ["DbPort", "OrderNotificationService"],
    },
    FirstPartyOriginGuard,
    {
      provide: "OrderNotificationService",
      useFactory: (d: DbPort, email: TransactionalEmailPort) => new OrderNotificationService(d, email),
      inject: ["DbPort", TRANSACTIONAL_EMAIL_PORT],
    },
    {
      provide: "OrderExpiryService",
      useFactory: (d: DbPort, paymongo: PayMongoPort) => {
        const service = new OrderExpiryService(d, paymongo);
        service.start();
        return service;
      },
      inject: ["DbPort", PAYMONGO_PORT],
    },
    {
      provide: InventoryCountService,
      useFactory: (d: DbPort, procurement: ProcurementService) => new InventoryCountService(d, procurement),
      inject: ["DbPort", ProcurementService],
    },
    SessionGuard,
    CsrfGuard,
    // Phase 12: DATABASE_URL selects the PostgreSQL runtime store (the
    // migrations under packages/database must be applied to that database
    // first — see scripts/verify-phase11-migration.mjs). Unset keeps the
    // single-process memory store for local dev and tests. The context is
    // its own provider so shutdown can end the pool.
    {
      provide: "PgContext",
      useFactory: (): PgContext | null => {
        const url = runtimeDatabaseUrl();
        return url ? new PgContext(url) : null;
      },
    },
    {
      provide: "DbPort",
      useFactory: (ctx: PgContext | null) => {
        if (ctx) {
          // Rate limits become cross-process with the store (PLAN §7).
          setRateLimitBackend(new PgRateLimitBackend(ctx));
          return new PgDbPort(ctx);
        }
        setRateLimitBackend(null);
        return createMemoryDb();
      },
      inject: ["PgContext"],
    },
    { provide: APP_FILTER, useClass: AuthErrorFilter },
  ],
})
export class AppModule implements NestModule {
  constructor(@Optional() @Inject("PgContext") private readonly pg: PgContext | null) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, SecurityHeadersMiddleware, MetricsMiddleware).forRoutes("*");
  }

  // Hosting platforms stop instances with SIGTERM; ending the pool lets
  // in-flight transactions commit before the process exits.
  async beforeApplicationShutdown(): Promise<void> {
    await this.pg?.close();
  }
}

export async function createTestApp(options: { paymongo?: PayMongoPort; humanVerification?: HumanVerificationPort; email?: TransactionalEmailPort } = {}): Promise<INestApplication> {
  // Same store contract as boot: memory unless DATABASE_URL opts into
  // PostgreSQL (used by the load cohorts and any pg-backed contract run).
  const databaseUrl = runtimeDatabaseUrl();
  const db: DbPort = databaseUrl
    ? new PgDbPort(new PgContext(databaseUrl))
    : createMemoryDb();
  const moduleRef = await Test.createTestingModule({
  controllers: [HealthController, AuthController, ApprovalController, TenantController, BusinessController, ProductModelController, CatalogController, InventoryController, InventoryCountController, SalesController, PaymentsController, ReceiptsController, ShiftController, CustomerController, ExpenseController, RefundController, ReportingController, BranchController, TransferController, SyncController, DeviceController, PlatformController, BillingController, ExportController, PrintController, DisplayController, ApiTokenController, MembershipController, ReceiptShareController, PayMongoController, ProcurementController, ValueController, MetricsController, OrderController, PublicOrderController],
    providers: [
      { provide: "DbPort", useValue: db },
      { provide: PAYMONGO_PORT, useValue: options.paymongo ?? createPayMongoFromEnv({}) },
      { provide: HUMAN_VERIFICATION_PORT, useValue: options.humanVerification ?? DISABLED_HUMAN_VERIFICATION },
      { provide: TRANSACTIONAL_EMAIL_PORT, useValue: options.email ?? NOOP_TRANSACTIONAL_EMAIL },
      {
        provide: AuthService,
        useFactory: (d: DbPort, email: TransactionalEmailPort) => new AuthService(d, email),
        inject: ["DbPort", TRANSACTIONAL_EMAIL_PORT],
      },
      ManagerApprovalPolicyService,
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
        provide: ProductModelService,
        useFactory: (d: DbPort) => new ProductModelService(d),
        inject: ["DbPort"],
      },
      {
        provide: InventoryService,
        useFactory: (d: DbPort) => new InventoryService(d),
        inject: ["DbPort"],
      },
      {
        provide: SalesService,
        useFactory: (d: DbPort, paymongo: PayMongoPort, email: TransactionalEmailPort) => new SalesService(d, paymongo, email),
        inject: ["DbPort", PAYMONGO_PORT, TRANSACTIONAL_EMAIL_PORT],
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
        provide: MembershipService,
        useFactory: (d: DbPort) => new MembershipService(d),
        inject: ["DbPort"],
      },
      {
        provide: SupportGrantService,
        useFactory: (d: DbPort) => new SupportGrantService(d),
        inject: ["DbPort"],
      },
      {
        provide: ExchangeService,
        useFactory: (d: DbPort) => new ExchangeService(d),
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
        provide: ApiTokenService,
        useFactory: (d: DbPort) => new ApiTokenService(d),
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
        provide: ProcurementService,
        useFactory: (d: DbPort) => new ProcurementService(d),
        inject: ["DbPort"],
      },
      {
        provide: OrderService,
        useFactory: (d: DbPort, notifications: OrderNotificationService) => new OrderService(d, notifications),
        inject: ["DbPort", "OrderNotificationService"],
      },
      FirstPartyOriginGuard,
      {
        provide: "OrderNotificationService",
        useFactory: (d: DbPort, email: TransactionalEmailPort) => new OrderNotificationService(d, email),
        inject: ["DbPort", TRANSACTIONAL_EMAIL_PORT],
      },
      {
        provide: "OrderExpiryService",
        useFactory: (d: DbPort, paymongo: PayMongoPort) => new OrderExpiryService(d, paymongo),
        inject: ["DbPort", PAYMONGO_PORT],
      },
      {
        provide: InventoryCountService,
        useFactory: (d: DbPort, procurement: ProcurementService) => new InventoryCountService(d, procurement),
        inject: ["DbPort", ProcurementService],
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
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  // Mirror production's single trusted reverse-proxy hop so forwarded-IP
  // abuse controls are exercised correctly in contract tests.
  app.set("trust proxy", 1);
  app.use(cookieParser() as RequestHandler);
  // createTestApp bypasses AppModule.configure(), so apply shared
  // middleware explicitly here (production covers it via configure()).
  app.use((req: Request, res: Response, next: NextFunction) => new RequestIdMiddleware().use(req, res, next));
  app.use(securityHeaders as RequestHandler);
  app.use(httpMetrics as RequestHandler);
  app.useLogger(false);
  await app.init();
  return app;
}
