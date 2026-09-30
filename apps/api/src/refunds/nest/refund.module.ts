import { Module } from "@nestjs/common";
import { RefundController } from "./refund.controller";
import { ExchangeService } from "./exchange.service";
import { RefundService } from "./refund.service";

@Module({
  controllers: [RefundController],
  providers: [RefundService, ExchangeService],
  exports: [RefundService, ExchangeService],
})
export class RefundModule {}
