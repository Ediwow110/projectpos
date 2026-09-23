ALTER TABLE "Sale" ADD COLUMN "registerId" TEXT;
CREATE INDEX "Sale_businessId_registerId_idx" ON "Sale"("businessId", "registerId");

CREATE TABLE "Register" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Register_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Register_businessId_name_key" ON "Register"("businessId", "name");
CREATE INDEX "Register_businessId_idx" ON "Register"("businessId");
ALTER TABLE "Register" ADD CONSTRAINT "Register_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Shift" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "registerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "openedBy" TEXT NOT NULL,
  "closedBy" TEXT,
  "openingFloatMinor" INTEGER NOT NULL DEFAULT 0,
  "countedCashMinor" INTEGER,
  "varianceMinor" INTEGER,
  "cashSalesMinor" INTEGER NOT NULL DEFAULT 0,
  "cashRefundsMinor" INTEGER NOT NULL DEFAULT 0,
  "cashExpensesMinor" INTEGER NOT NULL DEFAULT 0,
  "cashDepositsMinor" INTEGER NOT NULL DEFAULT 0,
  "cashWithdrawalsMinor" INTEGER NOT NULL DEFAULT 0,
  "adjustmentsMinor" INTEGER NOT NULL DEFAULT 0,
  "expectedCashMinor" INTEGER NOT NULL DEFAULT 0,
  "closeNotes" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Shift_businessId_registerId_status_idx" ON "Shift"("businessId", "registerId", "status");
CREATE INDEX "Shift_businessId_status_openedAt_idx" ON "Shift"("businessId", "status", "openedAt");
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_registerId_fkey"
  FOREIGN KEY ("registerId") REFERENCES "Register"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CashMovement" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "registerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "reason" TEXT,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashMovement_amountMinor_check" CHECK ("amountMinor" <> 0)
);
CREATE INDEX "CashMovement_businessId_shiftId_createdAt_idx" ON "CashMovement"("businessId", "shiftId", "createdAt");
CREATE INDEX "CashMovement_businessId_registerId_createdAt_idx" ON "CashMovement"("businessId", "registerId", "createdAt");
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
