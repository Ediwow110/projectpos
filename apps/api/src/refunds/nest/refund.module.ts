import { Module } from "@nestjs/common";
import { RefundController } from "./refund.controller";
import { RefundService } from "./refund.service";

@Module({
  controllers: [RefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
