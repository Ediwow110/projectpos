import { Module } from "@nestjs/common";
import { ApiTokenController } from "./apitoken.controller";
import { ApiTokenService } from "./apitoken.service";

@Module({
  controllers: [ApiTokenController],
  providers: [ApiTokenService],
  exports: [ApiTokenService],
})
export class ApiTokenModule {}
