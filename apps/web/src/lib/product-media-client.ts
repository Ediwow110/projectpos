import { ApiError, apiBase } from "./api";

export interface ProductMediaStatus {
  imageUrl: string | null;
  assetId: string | null;
}

export interface ProductMediaCapabilities {
  enabled: boolean;
  maxSourceBytes: number;
  mimeTypes: string[];
}

function productImageEndpoint(productId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(productId)) {
    throw new ApiError("VALIDATION", "Invalid product identifier.", "", 400);
  }
  return `${apiBase()}/api/v1/products/${productId}/image`;
}

async function mediaResponse(response: Response): Promise<ProductMediaStatus> {
  let body: unknown;
  try { body = await response.json(); } catch { throw new ApiError("INVALID_RESPONSE", "Product media service returned an invalid response.", "", response.status); }
  if (!response.ok) {
    const error = body as { code?: string; message?: string; correlationId?: string };
    throw new ApiError(error?.code ?? "HTTP_ERROR", error?.message ?? "Product media request failed.", error?.correlationId ?? "", response.status);
  }
  const status = body as ProductMediaStatus;
  if (typeof status !== "object" || status === null ||
    !(status.imageUrl === null || typeof status.imageUrl === "string") ||
    !(status.assetId === null || typeof status.assetId === "string")) {
    throw new ApiError("INVALID_RESPONSE", "Product media status was invalid.", "", response.status);
  }
  return status;
}

/** Uses first-party session and CSRF. Never explicitly set multipart Content-Type. */
export async function uploadProductImage(
  productId: string, file: File, expectedAssetId: string | null, csrfToken: string,
): Promise<ProductMediaStatus> {
  const url = productImageEndpoint(productId);
  const body = new FormData();
  body.set("expectedAssetId", expectedAssetId ?? "");
  body.set("image", file);
  const response = await fetch(url, {
    method: "POST", credentials: "include",
    headers: { "X-CSRF-Token": csrfToken },
    body,
    signal: AbortSignal.timeout(40_000),
  });
  return mediaResponse(response);
}

export async function removeProductImage(
  productId: string, expectedAssetId: string | null, csrfToken: string,
): Promise<ProductMediaStatus> {
  const response = await fetch(productImageEndpoint(productId), {
    method: "DELETE", credentials: "include",
    headers: { "X-CSRF-Token": csrfToken, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedAssetId }),
    signal: AbortSignal.timeout(15_000),
  });
  return mediaResponse(response);
}
