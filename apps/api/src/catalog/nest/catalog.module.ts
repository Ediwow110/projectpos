import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { AuthService } from "../../auth/nest/auth.service";
import { ProductModelController } from "./product-model.controller";
import { ProductModelService } from "./product-model.service";

@Module({
  controllers: [ProductModelController, CatalogController],
  providers: [CatalogService, ProductModelService, AuthService],
})
export class CatalogModule {}
