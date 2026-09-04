-- AlterTable
ALTER TABLE "Material" ADD COLUMN "criticality" TEXT;
ALTER TABLE "Material" ADD COLUMN "equipmentRef" TEXT;
ALTER TABLE "Material" ADD COLUMN "manufacturer" TEXT;
ALTER TABLE "Material" ADD COLUMN "partNumber" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StockRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNumber" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantityRequested" REAL NOT NULL,
    "deliveredQuantity" REAL NOT NULL DEFAULT 0,
    "receivedQuantity" REAL NOT NULL DEFAULT 0,
    "requiredByDate" DATETIME NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'NEW_REQUEST',
    "reason" TEXT,
    "note" TEXT,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL DEFAULT 'MATERIAL',
    "equipmentRef" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requestedByRole" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "acceptedAt" DATETIME,
    "rejectedByUserId" TEXT,
    "rejectedAt" DATETIME,
    "rejectionReason" TEXT,
    "routedToUserId" TEXT,
    "routedByUserId" TEXT,
    "routedAt" DATETIME,
    "assignedToUserId" TEXT,
    "assignedByUserId" TEXT,
    "assignedAt" DATETIME,
    "deliveredByUserId" TEXT,
    "deliveredAt" DATETIME,
    "deliveryNote" TEXT,
    "notReceivedReason" TEXT,
    "notReceivedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockRequest_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_routedToUserId_fkey" FOREIGN KEY ("routedToUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_routedByUserId_fkey" FOREIGN KEY ("routedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_deliveredByUserId_fkey" FOREIGN KEY ("deliveredByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockRequest" ("acceptedAt", "acceptedByUserId", "assignedAt", "assignedByUserId", "assignedToUserId", "completedAt", "createdAt", "deliveredAt", "deliveredByUserId", "deliveredQuantity", "deliveryNote", "fromLocationId", "id", "materialId", "notReceivedAt", "notReceivedReason", "note", "priority", "quantityRequested", "reason", "receivedQuantity", "rejectedAt", "rejectedByUserId", "rejectionReason", "requestNumber", "requestedByRole", "requestedByUserId", "requiredByDate", "routedAt", "routedByUserId", "routedToUserId", "status", "toLocationId", "updatedAt") SELECT "acceptedAt", "acceptedByUserId", "assignedAt", "assignedByUserId", "assignedToUserId", "completedAt", "createdAt", "deliveredAt", "deliveredByUserId", "deliveredQuantity", "deliveryNote", "fromLocationId", "id", "materialId", "notReceivedAt", "notReceivedReason", "note", "priority", "quantityRequested", "reason", "receivedQuantity", "rejectedAt", "rejectedByUserId", "rejectionReason", "requestNumber", "requestedByRole", "requestedByUserId", "requiredByDate", "routedAt", "routedByUserId", "routedToUserId", "status", "toLocationId", "updatedAt" FROM "StockRequest";
DROP TABLE "StockRequest";
ALTER TABLE "new_StockRequest" RENAME TO "StockRequest";
CREATE UNIQUE INDEX "StockRequest_requestNumber_key" ON "StockRequest"("requestNumber");
CREATE INDEX "StockRequest_status_idx" ON "StockRequest"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
