import { ApiError } from "./api";

/**
 * Typed checkout failure contract shared by the POS checkout flow and the
 * payment surfaces. The mapper is the single place that decides what the
 * cashier should read and whether the same transaction may be resubmitted.
 *
 * Payment-safety rule: any failure after a sale draft exists may mean the
 * server recorded something before the response was lost, so it must never
 * offer a blind retry. Those failures become `unknown_outcome` and point the
 * cashier at the sale-status surface instead.
 */
export type PosCheckoutFailureKind =
  | "stock"
  | "permission"
  | "session"
  | "validation"
  | "shift"
  | "config"
  | "connectivity"
  | "server"
  | "unknown_outcome";

export type PosCheckoutFailureAction =
  | { kind: "adjust_cart"; label: string }
  | { kind: "open_shift"; label: string; href: string }
  | { kind: "sign_in"; label: string; href: string }
  | { kind: "check_sale"; label: string; href: string }
  | { kind: "check_connection"; label: string }
  | { kind: "retry"; label: string }
  | { kind: "none" };

export interface PosCheckoutFailure {
  kind: PosCheckoutFailureKind;
  title: string;
  message: string;
  action: PosCheckoutFailureAction;
  /** True only when the payment action may resubmit the same transaction. */
  retryable: boolean;
  /** Diagnostic only. Never used as the primary cashier-facing copy. */
  code: string;
  correlationId: string;
  saleId: string | null;
}

export interface PosSaleAttemptContext {
  phase: "draft" | "checkout" | "complete";
  saleId: string | null;
}

const CONTEXT_KEY = "__posSaleAttemptContext" as const;

export function tagPosSaleAttempt<T>(error: T, context: PosSaleAttemptContext): T {
  if (error !== null && typeof error === "object") {
    Object.defineProperty(error, CONTEXT_KEY, {
      value: context,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  }
  return error;
}

export function posSaleAttemptContext(error: unknown): PosSaleAttemptContext | null {
  if (error === null || typeof error !== "object") return null;
  const value = (error as Record<string, unknown>)[CONTEXT_KEY];
  if (value === null || typeof value !== "object") return null;
  const context = value as PosSaleAttemptContext;
  const phases: PosSaleAttemptContext["phase"][] = ["draft", "checkout", "complete"];
  if (!phases.includes(context.phase)) return null;
  return context;
}

export function isRetryBlocked(failure: PosCheckoutFailure | null | undefined): boolean {
  return failure !== null && failure !== undefined && failure.retryable === false;
}

/**
 * Starting a fresh payment attempt (reopening, changing method, or a payment
 * shortcut) is allowed only when the previous failure is recoverable. An
 * unknown outcome must survive; otherwise the disabled pay action can be
 * bypassed and a sale that may already be recorded could be submitted again.
 */
export function shouldClearCheckoutFailureForNewAttempt(failure: PosCheckoutFailure | null): boolean {
  return failure?.kind !== "unknown_outcome";
}

function saleStatusAction(saleId: string | null): PosCheckoutFailureAction {
  return {
    kind: "check_sale",
    label: "Check sale status",
    href: saleId ? `/sales/${encodeURIComponent(saleId)}` : "/sales",
  };
}

function unknownOutcome(error: unknown, saleId: string | null): PosCheckoutFailure {
  const api = error instanceof ApiError ? error : null;
  return {
    kind: "unknown_outcome",
    title: "Payment status unknown",
    message:
      "Payment status unknown. This request may already be recorded on the server. Do not retry payment; check the sale status first.",
    action: saleStatusAction(saleId),
    retryable: false,
    code: api?.code ?? "UNEXPECTED_ERROR",
    correlationId: api?.correlationId ?? "",
    saleId,
  };
}

function humanDetail(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length < 6 || trimmed.length > 240) return null;
  if (trimmed.includes("_")) return null;
  if (!/\s/.test(trimmed)) return null;
  if (!/[a-z]/.test(trimmed)) return null;
  return trimmed;
}

const SESSION_CODES = new Set([
  "UNAUTHENTICATED",
  "UNAUTHORIZED",
  "SESSION_EXPIRED",
  "AUTH_REQUIRED",
  "AUTH_REAUTH_REQUIRED",
]);

const AMBIGUOUS_CODES = new Set([
  "NETWORK_ERROR",
  "NETWORK_TIMEOUT",
  "HTTP_ERROR",
  "SERVICE_UNAVAILABLE",
  "INVALID_RESPONSE",
]);

/**
 * Provider responses that prove NexPOS does not know the provider's state.
 * These must never be presented as "nothing was charged, try again" even
 * though the API classifies them as 5xx/409.
 */
const AMBIGUOUS_PROVIDER_CODES = new Set([
  "PAYMENT_PROVIDER_INVALID_RESPONSE",
  "PAYMENT_PROVIDER_MISMATCH",
]);

function isAmbiguous(error: ApiError): boolean {
  return AMBIGUOUS_CODES.has(error.code) || error.status >= 500;
}

export function checkoutFailureFromError(error: unknown): PosCheckoutFailure {
  const context = posSaleAttemptContext(error);
  const saleId = context?.saleId ?? null;

  if (!(error instanceof ApiError)) {
    return {
      kind: "unknown_outcome",
      title: "Payment failed",
      message:
        "Payment failed unexpectedly, and the payment status is unknown. Check the sale status before trying again.",
      action: saleStatusAction(saleId),
      retryable: false,
      code: "UNEXPECTED_ERROR",
      correlationId: "",
      saleId,
    };
  }

  if (error.code === "INSUFFICIENT_STOCK") {
    return {
      kind: "stock",
      title: "Not enough stock",
      message:
        "Not enough stock for one or more items. Go back to the sale, reduce the quantity, then try again.",
      action: { kind: "adjust_cart", label: "Back to sale to adjust" },
      retryable: true,
      code: error.code,
      correlationId: error.correlationId,
      saleId,
    };
  }

  if (SESSION_CODES.has(error.code) || error.status === 401) {
    return {
      kind: "session",
      title: "Sign in again",
      message: "Your session expired before the payment was confirmed. Sign in again, then return to this sale.",
      action: { kind: "sign_in", label: "Sign in again", href: "/login" },
      retryable: false,
      code: error.code,
      correlationId: error.correlationId,
      saleId,
    };
  }

  if (error.code === "SHIFT_NO_OPEN_SHIFT") {
    return {
      kind: "shift",
      title: "No open shift",
      message: "This register has no open shift. Open a shift, then finish this payment.",
      action: { kind: "open_shift", label: "Open a shift", href: "/shifts" },
      retryable: true,
      code: error.code,
      correlationId: error.correlationId,
      saleId,
    };
  }

  if (error.code === "FORBIDDEN" || error.status === 403) {
    return {
      kind: "permission",
      title: "Approval needed",
      message:
        "You do not have permission to complete this sale. Ask an owner or manager to approve it or take over the payment.",
      action: { kind: "none" },
      retryable: false,
      code: error.code,
      correlationId: error.correlationId,
      saleId,
    };
  }

  if (error.code === "PAYMENT_PROVIDER_NOT_CONFIGURED") {
    return {
      kind: "config",
      title: "Payment method not configured",
      message:
        "This payment method is not configured yet. Choose another method or ask an owner to finish PayMongo setup.",
      action: { kind: "none" },
      retryable: false,
      code: error.code,
      correlationId: error.correlationId,
      saleId,
    };
  }

  if (AMBIGUOUS_PROVIDER_CODES.has(error.code)) {
    return unknownOutcome(error, saleId);
  }

  // Any other provider code still means the request may have reached the
  // provider. NexPOS cannot prove that no money moved, so it must not offer
  // a blind retry and must not tell the cashier that nothing was charged.
  if (error.code.startsWith("PAYMENT_PROVIDER")) {
    return unknownOutcome(error, saleId);
  }

  if (isAmbiguous(error) && saleId) {
    return unknownOutcome(error, saleId);
  }

  if (isAmbiguous(error)) {
    if (error.code === "NETWORK_ERROR" || error.code === "NETWORK_TIMEOUT") {
      // The attempt may already be recorded on the server: the connection
      // dropped, so the client never learned whether the write landed. The
      // attempt is addressed by an idempotency key, so retrying resumes the
      // SAME attempt and cannot create a second sale.
      return {
        kind: "connectivity",
        title: "Connection problem",
        message:
          "The connection dropped before NexPOS confirmed the attempt. It may already be recorded - retrying resumes the same attempt and cannot create a second sale.",
        action: { kind: "check_connection", label: "Check connection and retry" },
        retryable: true,
        code: error.code,
        correlationId: error.correlationId,
        saleId: null,
      };
    }
    return {
      kind: "server",
      title: "Service problem",
      message:
        "NexPOS could not confirm the attempt. It may already be recorded - retrying resumes the same attempt and cannot create a second sale.",
      action: { kind: "retry", label: "Try again" },
      retryable: true,
      code: error.code,
      correlationId: error.correlationId,
      saleId: null,
    };
  }

  if (error.status === 409) {
    return unknownOutcome(error, saleId);
  }

  const detail = humanDetail(error.message);
  return {
    kind: "validation",
    title: "Review the sale",
    message: detail ?? "The server rejected this sale. Review the cart and try again.",
    action: { kind: "retry", label: "Review and try again" },
    retryable: true,
    code: error.code,
    correlationId: error.correlationId,
    saleId,
  };
}

/**
 * Preconditions that stop checkout before a payment request is sent. They
 * reuse the same contract so the open payment dialog always explains why.
 */
export const preconditionFailures = {
  cartEmpty(): PosCheckoutFailure {
    return {
      kind: "validation",
      title: "Cart is empty",
      message: "Add an item to the sale before taking payment.",
      action: { kind: "none" },
      retryable: false,
      code: "CART_EMPTY",
      correlationId: "",
      saleId: null,
    };
  },
  workspaceUnconfirmed(): PosCheckoutFailure {
    return {
      kind: "session",
      title: "Still confirming your workspace",
      message: "NexPOS is still confirming the signed-in workspace. Try again in a moment.",
      action: { kind: "none" },
      retryable: true,
      code: "WORKSPACE_UNCONFIRMED",
      correlationId: "",
      saleId: null,
    };
  },
  reconnectRequired(message: string, saleId: string | null = null): PosCheckoutFailure {
    return {
      kind: "connectivity",
      title: "Reconnect to continue",
      message,
      action: { kind: "check_connection", label: "Check connection and retry" },
      retryable: true,
      code: "OFFLINE",
      correlationId: "",
      saleId,
    };
  },
  providerSetupRequired(message: string): PosCheckoutFailure {
    return {
      kind: "config",
      title: "Payment method not configured",
      message,
      action: { kind: "none" },
      retryable: false,
      code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      correlationId: "",
      saleId: null,
    };
  },
  internalTenderRequired(): PosCheckoutFailure {
    return {
      kind: "validation",
      title: "External tender required",
      message:
        "Gift-card loads must be paid with cash or an external provider. Choose a different payment method.",
      action: { kind: "none" },
      retryable: false,
      code: "GIFT_CARD_LOAD_INTERNAL_TENDER",
      correlationId: "",
      saleId: null,
    };
  },
};
