import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { AuthService } from "../../auth/nest/auth.service";

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, AuthService],
})
export class CatalogModule {}
