import { SENSITIVE_ACTIONS } from "@pos/auth";
import { hashPassword } from "../auth/password";
import { DEFAULT_PAYMENT_METHODS } from "../sales/payment-methods";

export const ALL_PERMISSIONS: readonly string[] = SENSITIVE_ACTIONS as unknown as readonly string[];

export const ROLE_SEED: Record<"owner" | "manager" | "cashier" | "inventory", string[]> = {
  owner: [...ALL_PERMISSIONS],
  // refund.override is owner-only: refunds above the configured threshold
  // need an owner decision (FR-REFUND-02).
  manager: ALL_PERMISSIONS.filter((p) => p !== "user.manage" && p !== "settings.write" && p !== "refund.override"),
  cashier: ALL_PERMISSIONS.filter(
    (p) =>
      p !== "price.edit" &&
      p !== "cost.view" &&
      p !== "discount.override" &&
      p !== "sale.refund" &&
      p !== "sale.void" &&
      p !== "refund.override" &&
      p !== "inventory.adjust" &&
      p !== "shift.close.override" &&
      p !== "settings.write" &&
      p !== "user.manage" &&
      p !== "export.run",
  ),
  inventory: ALL_PERMISSIONS.filter(
    (p) => p !== "sale.refund" && p !== "refund.override" && p !== "user.manage" && p !== "settings.write",
  ),
};

export interface RegistrationInput {
  ownerName: string;
  email: string;
  password: string;
  businessName: string;
}

export interface RegistrationSeed {
  user: { name: string; email: string; passwordHash: string };
  business: { name: string; currency: string };
  ownerRoleName: string;
  roles: Record<string, string[]>;
  allPermissions: readonly string[];
  defaultSettings: Array<{ key: string; value: unknown }>;
  onboarding: { currentStep: string; steps: Record<string, "done" | "skipped" | "pending"> };
}

export async function buildRegistrationSeed(input: RegistrationInput): Promise<RegistrationSeed> {
  const passwordHash = await hashPassword(input.password);
  return {
    user: { name: input.ownerName, email: input.email, passwordHash },
    business: { name: input.businessName, currency: "PHP" },
    ownerRoleName: "owner",
    roles: {
      owner: ROLE_SEED.owner,
      manager: ROLE_SEED.manager,
      cashier: ROLE_SEED.cashier,
      inventory: ROLE_SEED.inventory,
    },
    allPermissions: ALL_PERMISSIONS,
    defaultSettings: [
      { key: "currency", value: "PHP" },
      // FR-PAY-01: methods are data; every new business starts with the
      // plan's initial six and can reconfigure them.
      { key: "paymentMethods", value: DEFAULT_PAYMENT_METHODS },
    ],
    onboarding: {
      currentStep: "taxCurrency",
      steps: {
        businessDetails: "done",
        taxCurrency: "pending",
        receiptSetup: "pending",
        products: "pending",
        employees: "pending",
      },
    },
  };
}

export function resolveActiveBusiness(membershipBusinessIds: string[], requestedId: string): string {
  if (!membershipBusinessIds.includes(requestedId)) throw new Error("TENANT_MISMATCH");
  return requestedId;
}
