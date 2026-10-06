CREATE TABLE "RoleAssignment" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "assignmentType" TEXT NOT NULL,
  "branchId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "assignedBy" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL,
  "assignmentReason" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "revocationReason" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RoleAssignment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoleAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "BusinessMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoleAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RoleAssignment_assignmentType_check" CHECK ("assignmentType" IN ('PERMANENT', 'TEMPORARY')),
  CONSTRAINT "RoleAssignment_expiry_check" CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt"),
  CONSTRAINT "RoleAssignment_temporary_fields_check" CHECK ("assignmentType" = 'PERMANENT' OR ("expiresAt" IS NOT NULL AND NULLIF(BTRIM("assignmentReason"), '') IS NOT NULL))
);

CREATE INDEX "RoleAssignment_businessId_membershipId_idx" ON "RoleAssignment"("businessId", "membershipId");
CREATE INDEX "RoleAssignment_businessId_branchId_idx" ON "RoleAssignment"("businessId", "branchId");
CREATE INDEX "RoleAssignment_membershipId_revokedAt_startsAt_expiresAt_idx" ON "RoleAssignment"("membershipId", "revokedAt", "startsAt", "expiresAt");
CREATE INDEX "RoleAssignment_businessId_idempotencyKey_idx" ON "RoleAssignment"("businessId", "idempotencyKey");
CREATE UNIQUE INDEX "RoleAssignment_businessId_idempotencyKey_key" ON "RoleAssignment"("businessId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

INSERT INTO "RoleAssignment" ("id", "businessId", "membershipId", "roleId", "assignmentType", "startsAt", "assignedBy", "assignedAt", "assignmentReason")
SELECT 'role_assignment_' || m."id", m."businessId", m."id", m."roleId", 'PERMANENT', m."createdAt", m."userId", m."createdAt", 'Migrated from BusinessMembership.role'
FROM "BusinessMembership" m
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "RoleAssignment" ENABLE ROW LEVEL SECURITY;
