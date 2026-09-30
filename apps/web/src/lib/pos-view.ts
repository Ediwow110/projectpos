export type PaymentPresentation = {
  tone: "ok" | "warn" | "info" | "neutral";
  state: "completed" | "unknown" | "pending" | "error" | "idle";
};

export type CompletedSaleView = {
  id: string;
  status: string;
  payments: Array<{ id: string }>;
};

export type CompleteSaleResponse =
  | CompletedSaleView
  | {
      code: string;
      message: string;
      sale: CompletedSaleView;
    };

export function saleFromCompleteResponse(response: CompleteSaleResponse): CompletedSaleView {
  return "sale" in response ? response.sale : response;
}

export function paymentPresentation(status: string): PaymentPresentation {
  const normalized = status.toLowerCase();
  if (normalized.includes("status unknown") || normalized.includes("do not retry blindly")) {
    return { tone: "warn", state: "unknown" };
  }
  if (normalized.includes("queued offline") || normalized.includes("pending sync") || normalized.includes("provisional")) {
    return { tone: "info", state: "pending" };
  }
  if (normalized.includes("sale completed")) {
    return { tone: "ok", state: "completed" };
  }
  if (normalized === "") return { tone: "neutral", state: "idle" };
  return { tone: "neutral", state: "error" };
}

export function canPresentPayAction(cartCount: number, canSell: boolean): boolean {
  return cartCount > 0 && canSell;
}

export function posSaleErrorMessage(code: string, message: string, hasDiscount: boolean): string {
  if (hasDiscount && code === "FORBIDDEN") {
    return "FORBIDDEN: Discount requires discount.override authorization. Ask an owner or manager to authorize or reduce the discount; manager PIN approval is not available yet.";
  }
  return `${code}: ${message}`;
}

export function productInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]!.slice(0, 1) + words[1]!.slice(0, 1)).toUpperCase();
}

export function productTileClass(name: string): string {
  const palette = ["bg-[#4a2118]", "bg-[#302e2b]", "bg-[#34302c]", "bg-[#3d332d]", "bg-[#292725]", "bg-[#46342e]"];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return palette[hash % palette.length]!;
}
