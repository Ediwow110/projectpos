ALTER TABLE "Session" ADD COLUMN "activeBranchId" TEXT;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_activeBranchId_fkey"
  FOREIGN KEY ("activeBranchId") REFERENCES "Branch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Session_activeBranchId_idx" ON "Session"("activeBranchId");
