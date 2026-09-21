import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, CsrfGuard],
  exports: [AuthService, SessionGuard, CsrfGuard],
})
export class AuthNestModule {}
