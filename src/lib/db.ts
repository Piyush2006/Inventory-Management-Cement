import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaWalReady?: Promise<unknown> };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// SQLite's default rollback-journal mode fsyncs on every transaction commit, which is
// far too slow for this app's write-heavy ledger (every stock movement is its own
// transaction). WAL mode batches those fsyncs and is safe for a single-process app.
// Scripts that fire off writes immediately after import (e.g. prisma/seed.ts) should
// `await ensureSqliteTuned()` first so the pragmas are guaranteed to have taken effect.
if (!globalForPrisma.prismaWalReady) {
  // journal_mode returns the resulting mode as a row, so it needs $queryRawUnsafe;
  // synchronous returns no rows, so it uses $executeRawUnsafe. Swallow SQLITE_BUSY here —
  // it only means another connection (e.g. a parallel test file's own client) is mid-way
  // through setting the same pragma, which is harmless to ignore.
  globalForPrisma.prismaWalReady = prisma
    .$queryRawUnsafe("PRAGMA journal_mode=WAL;")
    .then(() => prisma.$executeRawUnsafe("PRAGMA synchronous=NORMAL;"))
    .catch(() => undefined);
}
export function ensureSqliteTuned() {
  return globalForPrisma.prismaWalReady;
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
