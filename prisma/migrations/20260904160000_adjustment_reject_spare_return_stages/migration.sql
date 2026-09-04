-- AlterTable
ALTER TABLE "PhysicalCount" ADD COLUMN "rejectedAt" DATETIME;
ALTER TABLE "PhysicalCount" ADD COLUMN "rejectionReason" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SpareReturn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnReference" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "originalIssueReference" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "locationId" TEXT,
    "returnedBy" TEXT NOT NULL,
    "reportedByUserId" TEXT,
    "processedByUserId" TEXT,
    "condition" TEXT,
    "reason" TEXT,
    "remarks" TEXT,
    "inventoryTransactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "SpareReturn_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "StockRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpareReturn_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpareReturn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SpareReturn_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SpareReturn_processedByUserId_fkey" FOREIGN KEY ("processedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SpareReturn_inventoryTransactionId_fkey" FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SpareReturn" ("condition", "createdAt", "id", "inventoryTransactionId", "locationId", "materialId", "originalIssueReference", "processedByUserId", "quantity", "reason", "remarks", "requestId", "returnReference", "returnedBy") SELECT "condition", "createdAt", "id", "inventoryTransactionId", "locationId", "materialId", "originalIssueReference", "processedByUserId", "quantity", "reason", "remarks", "requestId", "returnReference", "returnedBy" FROM "SpareReturn";
DROP TABLE "SpareReturn";
ALTER TABLE "new_SpareReturn" RENAME TO "SpareReturn";

-- Backfill: every pre-existing row was created under the old single-step flow, where the
-- processor was also, in effect, the reporter — carry that forward instead of leaving
-- reportedByUserId blank on historical rows.
UPDATE "SpareReturn" SET "reportedByUserId" = "processedByUserId" WHERE "reportedByUserId" IS NULL;

CREATE UNIQUE INDEX "SpareReturn_returnReference_key" ON "SpareReturn"("returnReference");
CREATE UNIQUE INDEX "SpareReturn_inventoryTransactionId_key" ON "SpareReturn"("inventoryTransactionId");
CREATE INDEX "SpareReturn_requestId_idx" ON "SpareReturn"("requestId");
CREATE INDEX "SpareReturn_materialId_idx" ON "SpareReturn"("materialId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

