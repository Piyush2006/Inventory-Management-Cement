import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { operationGroupTypes } from "./operations";
import type { ReportFilters } from "./types";

export interface StockMovementRow {
  id: string;
  timestamp: Date;
  materialName: string;
  category: string;
  uom: string;
  transactionType: string;
  quantity: number;
  fromLocationName: string | null;
  toLocationName: string | null;
  reference: string | null;
  userName: string | null;
}

const PAGE_SIZE = 25;
const EXPORT_ROW_CAP = 2000;

function buildWhere(filters: ReportFilters): Prisma.InventoryTransactionWhereInput {
  const types = operationGroupTypes(filters.operation);
  return {
    ...(filters.materialId ? { materialId: filters.materialId } : {}),
    ...(filters.locationId ? { OR: [{ sourceLocationId: filters.locationId }, { destinationLocationId: filters.locationId }] } : {}),
    ...(filters.category ? { material: { category: filters.category } } : {}),
    ...(types ? { transactionType: { in: types } } : {}),
    ...(filters.reference ? { reference: { contains: filters.reference } } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.from || filters.to
      ? { timestamp: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };
}

async function resolveUserNames(userIds: (string | null)[]) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map<string, string>();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

function toRows(
  transactions: Prisma.InventoryTransactionGetPayload<{ include: { material: true; sourceLocation: true; destinationLocation: true } }>[],
  userNames: Map<string, string>,
): StockMovementRow[] {
  return transactions.map((t) => ({
    id: t.id,
    timestamp: t.timestamp,
    materialName: t.material.name,
    category: t.material.category,
    uom: t.uom,
    transactionType: t.transactionType,
    quantity: t.quantity,
    fromLocationName: t.sourceLocation?.name ?? null,
    toLocationName: t.destinationLocation?.name ?? null,
    reference: t.reference,
    userName: t.userId ? (userNames.get(t.userId) ?? null) : null,
  }));
}

/** Paged display query — what the table on screen renders. */
export async function getStockMovementReport(filters: ReportFilters, page = 1) {
  const where = buildWhere(filters);
  const [transactions, totalCount] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      include: { material: true, sourceLocation: true, destinationLocation: true },
      orderBy: { timestamp: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);
  const userNames = await resolveUserNames(transactions.map((t) => t.userId));
  return { rows: toRows(transactions, userNames), totalCount, page, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) };
}

/**
 * Separate, unpaginated query for CSV export — ExportCsvButton can only export rows the server
 * already fetched, so "Export" must always mean "every matching row," not "the current page."
 * Capped (not truly unbounded) to keep this a safe, predictable query at any data scale.
 */
export async function getStockMovementReportForExport(filters: ReportFilters) {
  const where = buildWhere(filters);
  const transactions = await prisma.inventoryTransaction.findMany({
    where,
    include: { material: true, sourceLocation: true, destinationLocation: true },
    orderBy: { timestamp: "desc" },
    take: EXPORT_ROW_CAP,
  });
  const userNames = await resolveUserNames(transactions.map((t) => t.userId));
  return toRows(transactions, userNames);
}
