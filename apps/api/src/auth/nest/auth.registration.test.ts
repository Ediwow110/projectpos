import { describe, expect, it } from "vitest";
import type { DbPort } from "../../common/db.port";
import { createMemoryDb } from "../../common/memory.db";
import { AuthService } from "./auth.service";

describe("registration transaction boundary", () => {
  it("performs persistent account provisioning inside one transaction", async () => {
    const base = createMemoryDb();
    let insideTransaction = false;

    const requireTransaction = <Args extends unknown[], Result>(
      name: string,
      fn: (...args: Args) => Promise<Result>,
    ) => async (...args: Args): Promise<Result> => {
      if (!insideTransaction) throw new Error(`WRITE_OUTSIDE_TRANSACTION:${name}`);
      return fn(...args);
    };

    const db = {
      ...base,
      async withTransaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T> {
        insideTransaction = true;
        try {
          return await fn(db);
        } finally {
          insideTransaction = false;
        }
      },
      createUser: requireTransaction("createUser", base.createUser.bind(base)),
      createBusiness: requireTransaction("createBusiness", base.createBusiness.bind(base)),
      createMembership: requireTransaction("createMembership", base.createMembership.bind(base)),
      saveSettings: requireTransaction("saveSettings", base.saveSettings.bind(base)),
      createSession: requireTransaction("createSession", base.createSession.bind(base)),
      createEmailVerificationToken: requireTransaction(
        "createEmailVerificationToken",
        base.createEmailVerificationToken.bind(base),
      ),
    } satisfies DbPort;

    const previousBilling = process.env["BILLING_ENABLED"];
    const previousVerification = process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"];
    process.env["BILLING_ENABLED"] = "0";
    process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"] = "0";
    try {
      const auth = new AuthService(db);
      const result = await auth.register(
        {
          ownerName: "Transaction Owner",
          email: `transaction-${Date.now()}@example.com`,
          password: "correct-horse-12",
          businessName: "Transaction Store",
        },
        { requestId: "registration-transaction", ip: "127.0.0.1", userAgent: "vitest" },
      );

      expect(result.user.id).toBeTruthy();
      expect(result.business.id).toBeTruthy();
    } finally {
      if (previousBilling === undefined) delete process.env["BILLING_ENABLED"];
      else process.env["BILLING_ENABLED"] = previousBilling;
      if (previousVerification === undefined) delete process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"];
      else process.env["AUTH_REQUIRE_EMAIL_VERIFICATION"] = previousVerification;
    }
  });
});
