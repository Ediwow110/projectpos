import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { defaultOnboardingState } from "../../business/onboarding";
import { TenantService } from "./tenant.service";

async function profileFor(role: "owner" | "cashier") {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Guard Store", currency: "PHP" });
  const user = await db.createUser({
    name: role,
    email: `${role}-profile@example.com`,
    passwordHash: "unused",
    emailVerified: true,
  });
  await db.createMembership({ businessId: business.id, userId: user.id, role });
  await db.saveSettings(business.id, { onboarding: defaultOnboardingState() });

  return new TenantService(db).me(user.id, business.id);
}

describe("tenant profile onboarding gate", () => {
  it("marks an owner with incomplete required setup as onboardingRequired", async () => {
    await expect(profileFor("owner")).resolves.toMatchObject({ onboardingRequired: true });
  });

  it("does not gate a cashier on the owner's business setup state", async () => {
    await expect(profileFor("cashier")).resolves.toMatchObject({ onboardingRequired: false });
  });

  it("starts with the workspace tour unseen and persists dismissal for that user", async () => {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Tour Store", currency: "PHP" });
    const user = await db.createUser({
      name: "Owner",
      email: "tour-owner@example.com",
      passwordHash: "unused",
      emailVerified: true,
    });
    await db.createMembership({ businessId: business.id, userId: user.id, role: "owner" });
    await db.saveSettings(business.id, { onboarding: defaultOnboardingState() });
    const service = new TenantService(db);

    await expect(service.me(user.id, business.id)).resolves.toMatchObject({ workspaceTourSeen: false });
    await service.markWorkspaceTourSeen(user.id);
    await expect(service.me(user.id, business.id)).resolves.toMatchObject({ workspaceTourSeen: true });
  });
});
