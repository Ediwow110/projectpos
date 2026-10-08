import { Module } from "@nestjs/common";
import { SalesController } from "./sales.controller";
import { PaymentsController } from "./payments.controller";
import { ReceiptsController } from "./receipts.controller";
import { SalesService } from "./sales.service";

@Module({
  controllers: [SalesController, PaymentsController, ReceiptsController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
