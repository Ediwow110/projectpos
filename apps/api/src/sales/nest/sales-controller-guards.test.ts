import "reflect-metadata";
import { GUARDS_METADATA, MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { ApiTokenGuard } from "../../apitokens/api-token.guard";
import { SessionGuard } from "../../common/session.guard";
import { SalesController } from "./sales.controller";
import { PaymentsController } from "./payments.controller";
import { ReceiptsController } from "./receipts.controller";
import { AppModule } from "../../app.module";

describe("split sales controller authentication boundary", () => {
  it.each([
    ["sales", SalesController],
    ["payments", PaymentsController],
    ["receipts", ReceiptsController],
  ])("%s authenticates tokens before sessions for every route", (_name, controller) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
      ApiTokenGuard,
      SessionGuard,
    ]);
  });

  it("registers all split controllers in the runtime application module", () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule);
    expect(controllers).toContain(SalesController);
    expect(controllers).toContain(PaymentsController);
    expect(controllers).toContain(ReceiptsController);
  });
});
