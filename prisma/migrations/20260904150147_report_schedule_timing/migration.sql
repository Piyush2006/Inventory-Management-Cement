-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReportSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportType" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "timeOfDay" TEXT NOT NULL DEFAULT '09:00',
    "dayOfWeek" TEXT,
    "dayOfMonth" INTEGER,
    "recipientType" TEXT NOT NULL,
    "recipientRole" TEXT,
    "recipientUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENABLED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ReportSchedule" ("createdAt", "frequency", "id", "recipientRole", "recipientType", "recipientUserId", "reportType", "status", "updatedAt") SELECT "createdAt", "frequency", "id", "recipientRole", "recipientType", "recipientUserId", "reportType", "status", "updatedAt" FROM "ReportSchedule";
DROP TABLE "ReportSchedule";
ALTER TABLE "new_ReportSchedule" RENAME TO "ReportSchedule";
CREATE INDEX "ReportSchedule_status_idx" ON "ReportSchedule"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
