-- CreateTable
CREATE TABLE "SpareReturn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnReference" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "originalIssueReference" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "locationId" TEXT NOT NULL,
    "returnedBy" TEXT NOT NULL,
    "processedByUserId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "reason" TEXT,
    "remarks" TEXT,
    "inventoryTransactionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpareReturn_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "StockRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpareReturn_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpareReturn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpareReturn_processedByUserId_fkey" FOREIGN KEY ("processedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpareReturn_inventoryTransactionId_fkey" FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SpareReturn_returnReference_key" ON "SpareReturn"("returnReference");

-- CreateIndex
CREATE UNIQUE INDEX "SpareReturn_inventoryTransactionId_key" ON "SpareReturn"("inventoryTransactionId");

-- CreateIndex
CREATE INDEX "SpareReturn_requestId_idx" ON "SpareReturn"("requestId");

-- CreateIndex
CREATE INDEX "SpareReturn_materialId_idx" ON "SpareReturn"("materialId");
