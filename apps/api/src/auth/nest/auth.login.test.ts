import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { defaultOnboardingState } from "../../business/onboarding";
import { hashPassword } from "../password";
import { AuthService } from "./auth.service";

async function incompleteBusinessLogin(role: "owner" | "cashier"): Promise<boolean> {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Setup Store", currency: "PHP" });
  const user = await db.createUser({
    name: role,
    email: `${role}@example.com`,
    passwordHash: await hashPassword("correct-horse-12"),
    emailVerified: true,
  });
  await db.createMembership({ businessId: business.id, userId: user.id, role });
  await db.saveSettings(business.id, { onboarding: defaultOnboardingState() });

  const result = await new AuthService(db).login(
    { email: user.email, password: "correct-horse-12" },
    { requestId: "login-role-onboarding", ip: "127.0.0.1", userAgent: "vitest" },
  );
  return result.onboardingRequired;
}

describe("role-aware onboarding redirect", () => {
  it("requires incomplete onboarding for an owner", async () => {
    await expect(incompleteBusinessLogin("owner")).resolves.toBe(true);
  });

  it("does not send a cashier into the owner onboarding flow", async () => {
    await expect(incompleteBusinessLogin("cashier")).resolves.toBe(false);
  });
});
