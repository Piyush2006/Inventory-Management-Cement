-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Material" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "minStock" REAL,
    "maxStock" REAL,
    "defaultLocationId" TEXT,
    "tolerancePct" REAL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "partNumber" TEXT,
    "manufacturer" TEXT,
    "equipmentRef" TEXT,
    "criticality" TEXT,
    CONSTRAINT "Material_defaultLocationId_fkey" FOREIGN KEY ("defaultLocationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Material" ("active", "category", "createdAt", "criticality", "defaultLocationId", "equipmentRef", "id", "manufacturer", "materialCode", "minStock", "name", "partNumber", "tolerancePct", "uom", "updatedAt") SELECT "active", "category", "createdAt", "criticality", "defaultLocationId", "equipmentRef", "id", "manufacturer", "materialCode", "minStock", "name", "partNumber", "tolerancePct", "uom", "updatedAt" FROM "Material";
DROP TABLE "Material";
ALTER TABLE "new_Material" RENAME TO "Material";
CREATE UNIQUE INDEX "Material_materialCode_key" ON "Material"("materialCode");
CREATE INDEX "Material_category_idx" ON "Material"("category");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
