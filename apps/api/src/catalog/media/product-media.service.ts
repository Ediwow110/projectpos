import type { RequestAuth } from "../../common/request-context";
import type { DbPort } from "../../common/db.port";
import { normalizeProductImage, type ProductImageUpload } from "./product-image-validation";
import { assertOwnerMediaWrite } from "./product-media-config";
import { productMediaObjectPath, type ProductMediaStorage } from "./product-media.storage";

export class ProductMediaService {
  constructor(
    private readonly db: DbPort,
    private readonly storage: ProductMediaStorage | null,
  ) {}

  async upload(
    auth: RequestAuth & { via?: string },
    requestId: string,
    productId: string,
    file: ProductImageUpload,
    expectedAssetId: string | null,
  ) {
    assertOwnerMediaWrite(auth);
    if (!this.storage) throw new Error("PRODUCT_MEDIA_DISABLED");
    const product = await this.db.findProductById(productId, auth.businessId);
    if (!product) throw new Error("NOT_FOUND");
    const normalized = await normalizeProductImage(file);
    const path = productMediaObjectPath(auth.businessId, productId);
    let uploaded: { url: string };
    try {
      uploaded = await this.storage.put(path, normalized.buffer);
    } catch (error) {
      await this.storage.remove(path).catch(() => undefined);
      throw error;
    }
    try {
      return await this.db.replaceProductMediaAtomic(auth.businessId, productId, expectedAssetId, {
        businessId: auth.businessId,
        productId,
        actorId: auth.userId,
        storagePath: path,
        publicUrl: uploaded.url,
        contentType: normalized.contentType,
        bytes: normalized.bytes,
        width: normalized.width,
        height: normalized.height,
      }, requestId);
    } catch (error) {
      await this.storage.remove(path).catch(() => undefined);
      throw error;
    }
  }

  async remove(auth: RequestAuth & { via?: string }, requestId: string, productId: string, expectedAssetId: string | null) {
    assertOwnerMediaWrite(auth);
    if (!this.storage) throw new Error("PRODUCT_MEDIA_DISABLED");
    const product = await this.db.findProductById(productId, auth.businessId);
    if (!product) throw new Error("NOT_FOUND");
    return this.db.detachProductMediaAtomic(auth.businessId, productId, expectedAssetId, auth.userId, requestId);
  }
}
