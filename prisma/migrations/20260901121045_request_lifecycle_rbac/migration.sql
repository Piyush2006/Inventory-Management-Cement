-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "capacity" REAL,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "productGrade" TEXT,
    "bagWeightKg" REAL,
    "minStock" REAL,
    "safetyStock" REAL,
    "defaultLocationId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Material_defaultLocationId_fkey" FOREIGN KEY ("defaultLocationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL,
    "materialId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "uom" TEXT NOT NULL,
    "sourceLocationId" TEXT,
    "destinationLocationId" TEXT,
    "reference" TEXT,
    "processName" TEXT,
    "reason" TEXT,
    "batchLot" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryTransaction_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryTransaction_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryTransaction_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryBalance_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsumptionCoefficient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outputMaterialId" TEXT NOT NULL,
    "inputMaterialId" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    CONSTRAINT "ConsumptionCoefficient_outputMaterialId_fkey" FOREIGN KEY ("outputMaterialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConsumptionCoefficient_inputMaterialId_fkey" FOREIGN KEY ("inputMaterialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PhysicalCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "countedQuantity" REAL NOT NULL,
    "bookQuantityAtCount" REAL NOT NULL,
    "countedBy" TEXT NOT NULL,
    "countedAt" DATETIME NOT NULL,
    "note" TEXT,
    "adjustmentTransactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhysicalCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PhysicalCount_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "StockRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNumber" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantityRequested" REAL NOT NULL,
    "allocatedQuantity" REAL NOT NULL DEFAULT 0,
    "issuedQuantity" REAL NOT NULL DEFAULT 0,
    "receivedQuantity" REAL NOT NULL DEFAULT 0,
    "requiredByDate" DATETIME NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "note" TEXT,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedByRole" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "acceptedAt" DATETIME,
    "rejectedByUserId" TEXT,
    "rejectedAt" DATETIME,
    "rejectionReason" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockRequest_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRequest_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockRequestId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" DATETIME,
    CONSTRAINT "StockReservation_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RequestEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockRequestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "quantity" REAL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "reason" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestEvent_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RequestEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "referenceCode" TEXT,
    "contactInfo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PurchaseReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "orderedQuantity" REAL NOT NULL,
    "expectedDeliveryDate" DATETIME,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "stockRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseReference_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseReference_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseReference_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialReceipt" (
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
    "stockRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaterialReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialReceipt_purchaseReferenceId_fkey" FOREIGN KEY ("purchaseReferenceId") REFERENCES "PurchaseReference" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialReceipt_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialReceipt_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialReceipt_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Material_materialCode_key" ON "Material"("materialCode");

-- CreateIndex
CREATE INDEX "Material_category_idx" ON "Material"("category");

-- CreateIndex
CREATE INDEX "InventoryTransaction_materialId_timestamp_idx" ON "InventoryTransaction"("materialId", "timestamp");

-- CreateIndex
CREATE INDEX "InventoryTransaction_transactionType_idx" ON "InventoryTransaction"("transactionType");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_materialId_locationId_key" ON "InventoryBalance"("materialId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionCoefficient_outputMaterialId_inputMaterialId_key" ON "ConsumptionCoefficient"("outputMaterialId", "inputMaterialId");

-- CreateIndex
CREATE INDEX "PhysicalCount_locationId_materialId_idx" ON "PhysicalCount"("locationId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "StockRequest_requestNumber_key" ON "StockRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "StockRequest_status_idx" ON "StockRequest"("status");

-- CreateIndex
CREATE INDEX "StockReservation_materialId_locationId_status_idx" ON "StockReservation"("materialId", "locationId", "status");

-- CreateIndex
CREATE INDEX "RequestEvent_stockRequestId_timestamp_idx" ON "RequestEvent"("stockRequestId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReference_poNumber_key" ON "PurchaseReference"("poNumber");

-- CreateIndex
CREATE INDEX "PurchaseReference_status_idx" ON "PurchaseReference"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReceipt_grnNumber_key" ON "MaterialReceipt"("grnNumber");

-- CreateIndex
CREATE INDEX "MaterialReceipt_status_idx" ON "MaterialReceipt"("status");

-- CreateIndex
CREATE INDEX "MaterialReceipt_materialId_idx" ON "MaterialReceipt"("materialId");
