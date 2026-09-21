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
import { CatalogService } from "./catalog/nest/catalog.service";
import { InventoryService } from "./inventory/nest/inventory.service";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { SessionGuard } from "./common/session.guard";
import { CsrfGuard } from "./common/csrf.guard";
import { AuthErrorFilter } from "./common/auth-error.filter";
import type { DbPort } from "./common/db.port";
import { createMemoryDb } from "./common/memory.db";

@Module({
  controllers: [AuthController, TenantController, BusinessController, CatalogController, InventoryController],
  providers: [
    AuthService,
    TenantService,
    BusinessService,
    CatalogService,
    InventoryService,
    SessionGuard,
    CsrfGuard,
    { provide: APP_FILTER, useClass: AuthErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}

export async function createTestApp(): Promise<INestApplication> {
  const db: DbPort = createMemoryDb();
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController, TenantController, BusinessController, CatalogController, InventoryController],
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
  app.useLogger(false);
  await app.init();
  return app;
}
