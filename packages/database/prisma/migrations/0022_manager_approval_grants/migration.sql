CREATE TABLE "ManagerApprovalGrant" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "approverId" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagerApprovalGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagerApprovalGrant_tokenHash_key" ON "ManagerApprovalGrant"("tokenHash");
CREATE INDEX "ManagerApprovalGrant_businessId_requesterId_permission_idx" ON "ManagerApprovalGrant"("businessId", "requesterId", "permission");
CREATE INDEX "ManagerApprovalGrant_expiresAt_idx" ON "ManagerApprovalGrant"("expiresAt");

ALTER TABLE "ManagerApprovalGrant" ENABLE ROW LEVEL SECURITY;
