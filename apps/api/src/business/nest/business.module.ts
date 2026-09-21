import { Module } from "@nestjs/common";
import { BusinessController } from "./business.controller";
import { BusinessService } from "./business.service";
import { AuthService } from "../../auth/nest/auth.service";

@Module({
  controllers: [BusinessController],
  providers: [BusinessService, AuthService],
  exports: [BusinessService],
})
export class BusinessNestModule {}
