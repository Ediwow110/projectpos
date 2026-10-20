CREATE TABLE "ManagerApprovalRequest" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "branchId" TEXT,
  "registerId" TEXT,
  "kind" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "action" JSONB NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "stateFingerprint" TEXT,
  "status" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "approverId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionReason" TEXT,
  "tokenCiphertext" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "tokenClaimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagerApprovalRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagerApprovalRequest_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT "ManagerApprovalRequest_action_object" CHECK (jsonb_typeof("action") = 'object'),
  CONSTRAINT "ManagerApprovalRequest_approval_token_check" CHECK (("tokenCiphertext" IS NULL AND "tokenExpiresAt" IS NULL) OR ("status" = 'APPROVED' AND "tokenCiphertext" IS NOT NULL AND "tokenExpiresAt" IS NOT NULL AND "tokenClaimedAt" IS NULL))
);
CREATE UNIQUE INDEX "ManagerApprovalRequest_businessId_requesterId_idempotencyKey_key" ON "ManagerApprovalRequest"("businessId", "requesterId", "idempotencyKey");
CREATE INDEX "ManagerApprovalRequest_businessId_status_createdAt_idx" ON "ManagerApprovalRequest"("businessId", "status", "createdAt");
CREATE INDEX "ManagerApprovalRequest_businessId_requesterId_createdAt_idx" ON "ManagerApprovalRequest"("businessId", "requesterId", "createdAt");
ALTER TABLE "ManagerApprovalRequest" ADD CONSTRAINT "ManagerApprovalRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagerApprovalRequest" ENABLE ROW LEVEL SECURITY;
