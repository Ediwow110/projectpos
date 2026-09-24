CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "allowances" JSONB NOT NULL,
  "pricesMinor" JSONB NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'trialing',
  "trialEndsAt" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
  "providerRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subscription_businessId_key" ON "Subscription"("businessId");
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'PHP',
  "status" TEXT NOT NULL DEFAULT 'open',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Invoice_businessId_issuedAt_idx" ON "Invoice"("businessId", "issuedAt");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UsageCounter" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UsageCounter_businessId_key_period_key" ON "UsageCounter"("businessId", "key", "period");
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FeatureFlag" (
  "id" TEXT NOT NULL,
  "businessId" TEXT,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FeatureFlag_businessId_key_key" ON "FeatureFlag"("businessId", "key");
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BillingWebhookEvent" (
  "id" TEXT NOT NULL,
  "businessId" TEXT,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'applied',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingWebhookEvent_eventId_key" ON "BillingWebhookEvent"("eventId");

CREATE TABLE "ApiToken" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "scopes" JSONB NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
CREATE INDEX "ApiToken_businessId_idx" ON "ApiToken"("businessId");
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PrinterDevice" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "branchId" TEXT,
  "name" TEXT NOT NULL,
  "width" TEXT NOT NULL DEFAULT '80',
  "connection" TEXT NOT NULL DEFAULT 'test-double',
  CONSTRAINT "PrinterDevice_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PrinterDevice" ADD CONSTRAINT "PrinterDevice_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PrintJob" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "printerId" TEXT NOT NULL,
  "receiptNo" TEXT,
  "layout" TEXT NOT NULL DEFAULT '80',
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "payload" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PrintJob_businessId_status_idx" ON "PrintJob"("businessId", "status");
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_fkey"
  FOREIGN KEY ("printerId") REFERENCES "PrinterDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DisplayToken" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "registerId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisplayToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DisplayToken_tokenHash_key" ON "DisplayToken"("tokenHash");
CREATE INDEX "DisplayToken_businessId_registerId_idx" ON "DisplayToken"("businessId", "registerId");
ALTER TABLE "DisplayToken" ADD CONSTRAINT "DisplayToken_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Plan" ("id", "key", "name", "allowances", "pricesMinor", "isActive") VALUES
  ('plan_free', 'free', 'Free', '{"users":3,"products":100,"registers":1,"branches":0,"features":[]}', '{"monthlyMinor":0}', true),
  ('plan_basic', 'basic', 'Basic', '{"users":10,"products":2000,"registers":3,"branches":0,"features":["reports","customers","receipt_customization"]}', '{"monthlyMinor":49000}', true),
  ('plan_pro', 'pro', 'Pro', '{"users":50,"products":20000,"registers":10,"branches":0,"features":["reports","customers","receipt_customization","advanced_reports","employee_permissions","expenses","advanced_analytics"]}', '{"monthlyMinor":149000}', true),
  ('plan_enterprise', 'enterprise', 'Enterprise', '{"users":null,"products":null,"registers":null,"branches":null,"features":["reports","customers","receipt_customization","advanced_reports","employee_permissions","expenses","advanced_analytics","branches","central_management","api","advanced_permissions","integrations"]}', '{"monthlyMinor":0}', true);

INSERT INTO "Subscription" ("id", "businessId", "planId", "status", "currentPeriodEnd")
  SELECT 'sub_' || "id", "id", 'plan_enterprise', 'active', CURRENT_TIMESTAMP + INTERVAL '30 days' FROM "Business";
