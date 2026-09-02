-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dispatchReference" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "sourceLocationId" TEXT NOT NULL,
    "customerDestination" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "batchLot" TEXT,
    "weighmentReference" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" DATETIME,
    "loadingStartedByUserId" TEXT,
    "loadingStartedAt" DATETIME,
    "dispatchedByUserId" TEXT,
    "dispatchedAt" DATETIME,
    "inventoryTransactionId" TEXT,
    "cancelledByUserId" TEXT,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dispatch_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dispatch_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dispatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dispatch_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Dispatch_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Dispatch_dispatchedByUserId_fkey" FOREIGN KEY ("dispatchedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Dispatch_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DispatchEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dispatchId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "reason" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DispatchEvent_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DispatchEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_dispatchReference_key" ON "Dispatch"("dispatchReference");

-- CreateIndex
CREATE INDEX "Dispatch_status_idx" ON "Dispatch"("status");

-- CreateIndex
CREATE INDEX "DispatchEvent_dispatchId_timestamp_idx" ON "DispatchEvent"("dispatchId", "timestamp");
