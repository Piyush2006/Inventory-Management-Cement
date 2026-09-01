-- AlterTable
ALTER TABLE "Material" ADD COLUMN "tolerancePct" REAL;

-- CreateTable
CREATE TABLE "QualityBalance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QualityBalance_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QualityBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QualityStatusEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "reference" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QualityStatusEvent_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QualityStatusEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MaterialReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grnNumber" TEXT NOT NULL,
    "receiptDate" DATETIME NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseReferenceId" TEXT,
    "materialId" TEXT NOT NULL,
    "orderedQuantitySnapshot" REAL,
    "receivedQuantity" REAL NOT NULL,
    "acceptedQuantity" REAL NOT NULL,
    "rejectedQuantity" REAL NOT NULL,
    "qualityStatus" TEXT NOT NULL DEFAULT 'UNRESTRICTED',
    "destinationLocationId" TEXT NOT NULL,
    "batchLot" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" DATETIME,
    "invoiceAmount" REAL,
    "deliveryNoteNumber" TEXT,
    "supplierChallan" TEXT,
    "vehicleReference" TEXT,
    "truckNumber" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "postedAt" DATETIME,
    "inventoryTransactionId" TEXT,
    "reversalTransactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaterialReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialReceipt_purchaseReferenceId_fkey" FOREIGN KEY ("purchaseReferenceId") REFERENCES "PurchaseReference" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialReceipt_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialReceipt_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MaterialReceipt" ("acceptedQuantity", "batchLot", "createdAt", "deliveryNoteNumber", "destinationLocationId", "grnNumber", "id", "inventoryTransactionId", "invoiceAmount", "invoiceDate", "invoiceNumber", "materialId", "notes", "orderedQuantitySnapshot", "postedAt", "purchaseReferenceId", "receiptDate", "receivedQuantity", "rejectedQuantity", "reversalTransactionId", "status", "supplierChallan", "supplierId", "truckNumber", "updatedAt", "vehicleReference") SELECT "acceptedQuantity", "batchLot", "createdAt", "deliveryNoteNumber", "destinationLocationId", "grnNumber", "id", "inventoryTransactionId", "invoiceAmount", "invoiceDate", "invoiceNumber", "materialId", "notes", "orderedQuantitySnapshot", "postedAt", "purchaseReferenceId", "receiptDate", "receivedQuantity", "rejectedQuantity", "reversalTransactionId", "status", "supplierChallan", "supplierId", "truckNumber", "updatedAt", "vehicleReference" FROM "MaterialReceipt";
DROP TABLE "MaterialReceipt";
ALTER TABLE "new_MaterialReceipt" RENAME TO "MaterialReceipt";
CREATE UNIQUE INDEX "MaterialReceipt_grnNumber_key" ON "MaterialReceipt"("grnNumber");
CREATE INDEX "MaterialReceipt_status_idx" ON "MaterialReceipt"("status");
CREATE INDEX "MaterialReceipt_materialId_idx" ON "MaterialReceipt"("materialId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "QualityBalance_materialId_locationId_status_key" ON "QualityBalance"("materialId", "locationId", "status");

-- CreateIndex
CREATE INDEX "QualityStatusEvent_materialId_locationId_idx" ON "QualityStatusEvent"("materialId", "locationId");
