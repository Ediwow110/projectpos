import type { PlatformPort } from "./ports/platform.port";
import type { CatalogPort } from "./ports/catalog.port";
import type { InventoryPort } from "./ports/inventory.port";
import type { SalesPort } from "./ports/sales.port";
import type { ProcurementPort } from "./ports/procurement.port";

export type { PlatformPort } from "./ports/platform.port";
export type { CatalogPort } from "./ports/catalog.port";
export type { InventoryPort } from "./ports/inventory.port";
export type { SalesPort } from "./ports/sales.port";
export type { ProcurementPort } from "./ports/procurement.port";

export interface DbPort extends PlatformPort, CatalogPort, InventoryPort, SalesPort, ProcurementPort {}
