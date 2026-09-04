import { prisma } from "@/lib/db";
import type { ReportFilters } from "./types";

const DEFAULT_WINDOW_DAYS = 30;

export interface ConsumptionDetailRow {
  id: string;
  timestamp: Date;
  materialId: string;
  materialName: string;
  category: string;
  uom: string;
  locationName: string;
  quantity: number;
  reference: string | null;
}

export interface ConsumptionAggregateRow {
  materialId: string;
  materialName: string;
  category: string;
  uom: string;
  totalConsumed: number;
  averageDailyConsumption: number;
}

export async function getConsumptionReport(filters: ReportFilters) {
  const to = filters.to ?? new Date();
  const from = filters.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86400000);
  // Inclusive calendar-day span — never zero, so the average below is never a divide-by-zero.
  // Mirrors daysOfCover.ts's own guard: only total-consumed-is-zero gets an "N/A", not an
  // adaptive "days actually spanned by data" denominator.
  const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);

  const rows = await prisma.inventoryTransaction.findMany({
    where: {
      transactionType: "CONSUMPTION",
      timestamp: { gte: from, lte: to },
      ...(filters.materialId ? { materialId: filters.materialId } : {}),
      ...(filters.locationId ? { sourceLocationId: filters.locationId } : {}),
      ...(filters.category ? { material: { category: filters.category } } : {}),
    },
    include: { material: true, sourceLocation: true },
    orderBy: { timestamp: "desc" },
  });

  const detailRows: ConsumptionDetailRow[] = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    materialId: r.materialId,
    materialName: r.material.name,
    category: r.material.category,
    uom: r.uom,
    locationName: r.sourceLocation?.name ?? "—",
    quantity: r.quantity,
    reference: r.reference,
  }));

  const totalsByMaterial = new Map<string, { materialName: string; category: string; uom: string; total: number }>();
  for (const r of rows) {
    const entry = totalsByMaterial.get(r.materialId) ?? { materialName: r.material.name, category: r.material.category, uom: r.uom, total: 0 };
    entry.total += r.quantity;
    totalsByMaterial.set(r.materialId, entry);
  }
  const aggregateRows: ConsumptionAggregateRow[] = [...totalsByMaterial.entries()]
    .map(([materialId, v]) => ({ materialId, materialName: v.materialName, category: v.category, uom: v.uom, totalConsumed: v.total, averageDailyConsumption: v.total / spanDays }))
    .sort((a, b) => b.totalConsumed - a.totalConsumed);

  return { from, to, detailRows, aggregateRows };
}
