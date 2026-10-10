ALTER TABLE "AccountingBackfillIssue"
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedBy" TEXT,
  ADD COLUMN "resolutionEntryId" TEXT,
  ADD COLUMN "resolutionEvidence" TEXT;

ALTER TABLE "AccountingBackfillIssue"
  ADD CONSTRAINT "AccountingBackfillIssue_resolvedBy_fkey"
    FOREIGN KEY ("resolvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AccountingBackfillIssue_resolutionEntryId_fkey"
    FOREIGN KEY ("resolutionEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AccountingBackfillIssue_resolution_state_check"
    CHECK (("resolvedAt" IS NULL AND "resolvedBy" IS NULL AND "resolutionEntryId" IS NULL AND "resolutionEvidence" IS NULL)
      OR ("resolvedAt" IS NOT NULL AND "resolvedBy" IS NOT NULL AND "resolutionEntryId" IS NOT NULL AND "resolutionEvidence" IS NOT NULL));

CREATE UNIQUE INDEX "AccountingBackfillIssue_resolutionEntryId_key" ON "AccountingBackfillIssue"("resolutionEntryId");
