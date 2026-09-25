-- Phase 12: columns the runtime DbPort types require but earlier migrations
-- never stored (the runtime ran on the in-memory store until now). All
-- additive; defaults keep every existing row valid.
ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Session" ADD COLUMN "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "BusinessMembership" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "completedAt" TIMESTAMP(3);
