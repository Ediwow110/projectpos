import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { PlatformController } from "./platform.controller";
import { BillingService } from "./billing.service";

@Module({
  controllers: [BillingController, PlatformController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
