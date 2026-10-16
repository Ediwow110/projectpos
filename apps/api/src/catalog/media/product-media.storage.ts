import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ProductMediaConfig } from "./product-media-config";

export interface ProductMediaStorage {
  put(path: string, content: Buffer): Promise<{ url: string }>;
  remove(path: string): Promise<void>;
}

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,96}$/;
const MEDIA_PATH = /^businesses\/[A-Za-z0-9_-]{1,96}\/products\/[A-Za-z0-9_-]{1,96}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export function productMediaObjectPath(businessId: string, productId: string): string {
  if (!OPAQUE_ID.test(businessId) || !OPAQUE_ID.test(productId)) {
    throw new Error("PRODUCT_MEDIA_PATH");
  }
  return `businesses/${businessId}/products/${productId}/${randomUUID()}.webp`;
}

function assertSafeObjectPath(path: string): void {
  if (!MEDIA_PATH.test(path)) throw new Error("PRODUCT_MEDIA_PATH");
}

export class SupabaseMediaStorage implements ProductMediaStorage {
  private readonly client: Pick<SupabaseClient, "storage">;
  private readonly config: Extract<ProductMediaConfig, { enabled: true }>;

  constructor(
    config: Extract<ProductMediaConfig, { enabled: true }>,
    client?: Pick<SupabaseClient, "storage">,
  ) {
    this.config = config;
    this.client = client ?? createClient(config.supabaseUrl, config.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async put(path: string, content: Buffer): Promise<{ url: string }> {
    assertSafeObjectPath(path);
    if (!content.byteLength || content.byteLength > 1024 * 1024) throw new Error("PRODUCT_MEDIA_SIZE");
    try {
      const files = this.client.storage.from(this.config.bucket);
      const result = await files.upload(path, content, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: false,
      });
      if (result.error || !result.data?.path || result.data.path !== path) {
        throw new Error("PRODUCT_MEDIA_STORAGE");
      }
      const publicUrl = files.getPublicUrl(path).data.publicUrl;
      const parsed = new URL(publicUrl);
      const expected = `/storage/v1/object/public/${this.config.bucket}/${path}`;
      if (parsed.origin !== new URL(this.config.supabaseUrl).origin ||
        parsed.pathname !== expected || parsed.search || parsed.hash) {
        throw new Error("PRODUCT_MEDIA_STORAGE");
      }
      return { url: publicUrl };
    } catch {
      throw new Error("PRODUCT_MEDIA_STORAGE");
    }
  }

  async remove(path: string): Promise<void> {
    assertSafeObjectPath(path);
    try {
      const { error } = await this.client.storage.from(this.config.bucket).remove([path]);
      if (error && String(error.statusCode) !== "404") throw new Error("PRODUCT_MEDIA_STORAGE");
    } catch {
      throw new Error("PRODUCT_MEDIA_STORAGE");
    }
  }
}
