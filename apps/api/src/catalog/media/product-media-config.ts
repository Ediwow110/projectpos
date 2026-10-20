import type { RequestAuth } from "../../common/request-context";

export const PRODUCT_MEDIA_SOURCE_MAX_BYTES = 3 * 1024 * 1024;
export const PRODUCT_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface ProductMediaCapabilities {
  enabled: boolean;
  maxSourceBytes: number;
  mimeTypes: readonly string[];
}

export type ProductMediaConfig =
  | (ProductMediaCapabilities & { enabled: false })
  | (ProductMediaCapabilities & {
    enabled: true;
    supabaseUrl: string;
    secretKey: string;
    bucket: string;
    capabilities: ProductMediaCapabilities;
  });

export function productMediaConfigFromEnv(env: NodeJS.ProcessEnv): ProductMediaConfig {
  const enabled = env["PRODUCT_MEDIA_ENABLED"] === "1";
  if (env["PRODUCT_MEDIA_ENABLED"] && !["0", "1"].includes(env["PRODUCT_MEDIA_ENABLED"]!)) {
    throw new Error("PRODUCT_MEDIA_CONFIG");
  }
  const capabilities: ProductMediaCapabilities = {
    enabled,
    maxSourceBytes: PRODUCT_MEDIA_SOURCE_MAX_BYTES,
    mimeTypes: [...PRODUCT_MEDIA_MIME_TYPES],
  };
  if (!enabled) return { ...capabilities, enabled: false };

  const supabaseUrl = env["SUPABASE_URL"]?.trim();
  const secretKey = env["SUPABASE_SECRET_KEY"]?.trim();
  const bucket = env["PRODUCT_MEDIA_BUCKET"]?.trim();
  if (!supabaseUrl || !secretKey || bucket !== "nexpos-product-media") {
    throw new Error("PRODUCT_MEDIA_CONFIG");
  }
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error("PRODUCT_MEDIA_CONFIG");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PRODUCT_MEDIA_CONFIG");
  }
  return { ...capabilities, enabled: true, supabaseUrl: url.origin, secretKey, bucket, capabilities };
}

/** File mutations are owner-only NexPOS sessions, not generic catalog writes or API-token scopes. */
export function assertOwnerMediaWrite(auth: (RequestAuth & { via?: string }) | undefined): void {
  if (!auth || auth.via === "api-token" || auth.role !== "owner" ||
    !auth.userId || !auth.businessId || !auth.sessionId) {
    throw new Error("FORBIDDEN");
  }
}
