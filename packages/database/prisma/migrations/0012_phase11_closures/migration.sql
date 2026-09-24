-- Phase 11 requirement closures: email verification tokens, platform support
-- grants, post-close shift corrections, receipt share tokens, and the
-- session-persisted active business. All additive; no data backfill needed.

CREATE TABLE "EmailVerificationToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

CREATE TABLE "PlatformSupportGrant" (
  "id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformSupportGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformSupportGrant_tokenHash_key" ON "PlatformSupportGrant"("tokenHash");

CREATE TABLE "ShiftCorrection" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftCorrection_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ShiftCorrection" ADD CONSTRAINT "ShiftCorrection_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftCorrection" ADD CONSTRAINT "ShiftCorrection_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ShiftCorrection_businessId_shiftId_idx" ON "ShiftCorrection"("businessId", "shiftId");

CREATE TABLE "ReceiptShare" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReceiptShare_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ReceiptShare" ADD CONSTRAINT "ReceiptShare_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ReceiptShare_businessId_saleId_idx" ON "ReceiptShare"("businessId", "saleId");
CREATE INDEX "ReceiptShare_tokenHash_key" ON "ReceiptShare"("tokenHash");

ALTER TABLE "Session" ADD COLUMN "activeBusinessId" TEXT;
ALTER TABLE "Session" ADD CONSTRAINT "Session_activeBusinessId_fkey"
  FOREIGN KEY ("activeBusinessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT true;
