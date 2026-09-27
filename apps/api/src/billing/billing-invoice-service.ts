import { withScope } from "@pos/database";

import type { DbPort } from "../common/db.port";
import { billingEnabled } from "./entitlements";

const MAX_CATCHUP_PERIODS = 120;

type BillingInvoicePort = Pick<
  DbPort,
  | "appendAudit"
  | "createInvoice"
  | "getSubscription"
  | "listInvoices"
  | "updateSubscription"
  | "withLock"
>;

export class BillingInvoiceService {
  constructor(
    private readonly db: BillingInvoicePort,
    private readonly allowancesOf: (
      planId: string,
    ) => Promise<{ monthlyMinor: number }>,
  ) {}

  async listInvoices(businessId: string) {
    withScope(businessId, {});
    return this.db.listInvoices(businessId);
  }

  async rolloverIfDue(
    businessId: string,
    now: Date = new Date(),
  ): Promise<void> {
    withScope(businessId, {});
    if (!billingEnabled()) return;
    await this.db.withLock(
      "billing:" + businessId,
      async () => {
        const subscription =
          await this.db.getSubscription(businessId);
        if (
          !subscription ||
          subscription.status !== "active"
        ) {
          return;
        }
        const plan = await this.allowancesOf(
          subscription.planId,
        );
        let periodEnd = subscription.currentPeriodEnd;
        for (
          let billed = 0;
          billed < MAX_CATCHUP_PERIODS;
          billed++
        ) {
          if (periodEnd.getTime() > now.getTime()) break;
          const periodStart = new Date(
            periodEnd.getTime() - 30 * 86400000,
          );
          const invoice = await this.db.createInvoice({
            businessId,
            subscriptionId: subscription.id,
            periodStart,
            periodEnd,
            amountMinor: plan.monthlyMinor,
            currency: "PHP",
            status: "open",
            paidAt: null,
          });
          periodEnd = new Date(
            periodEnd.getTime() + 30 * 86400000,
          );
          await this.db.updateSubscription(
            subscription.id,
            businessId,
            { currentPeriodEnd: periodEnd },
          );
          await this.db.appendAudit({
            businessId,
            actorId: "system",
            action: "invoice.issued",
            entityType: "Invoice",
            entityId: invoice.id,
            requestId: "rollover-" + subscription.id,
          });
        }
      },
    );
  }

  async issueInvoice(
    businessId: string,
    actorId: string,
    requestId: string,
    input: {
      periodStart: Date;
      periodEnd: Date;
    },
  ): Promise<{
    id: string;
    amountMinor: number;
    status: string;
  }> {
    withScope(businessId, {});
    if (
      input.periodStart.getTime() >=
      input.periodEnd.getTime()
    ) {
      throw new Error("VALIDATION");
    }
    return this.db.withLock(
      "billing:" + businessId,
      async () => {
        const subscription =
          await this.db.getSubscription(businessId);
        if (!subscription) throw new Error("NOT_FOUND");
        const samePeriod = (
          await this.db.listInvoices(businessId)
        ).find(
          (invoice) =>
            invoice.periodStart.getTime() ===
              input.periodStart.getTime() &&
            invoice.periodEnd.getTime() ===
              input.periodEnd.getTime() &&
            invoice.status !== "void",
        );
        if (samePeriod) {
          return {
            id: samePeriod.id,
            amountMinor: samePeriod.amountMinor,
            status: samePeriod.status,
          };
        }
        const plan = await this.allowancesOf(
          subscription.planId,
        );
        const invoice = await this.db.createInvoice({
          businessId,
          subscriptionId: subscription.id,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          amountMinor: plan.monthlyMinor,
          currency: "PHP",
          status: "open",
          paidAt: null,
        });
        await this.db.appendAudit({
          businessId,
          actorId,
          action: "invoice.issued",
          entityType: "Invoice",
          entityId: invoice.id,
          requestId,
        });
        return {
          id: invoice.id,
          amountMinor: invoice.amountMinor,
          status: invoice.status,
        };
      },
    );
  }
}
