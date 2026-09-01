import { prisma } from "@/lib/db";
import { classifyStockStatus } from "@/lib/inventory/status";

const TRUCKLOAD_MT = 30; // configurable approximation for "truckloads remaining"

export async function getDashboardData() {
  const materials = await prisma.material.findMany({ where: { active: true }, include: { balances: true } });
  const locations = await prisma.location.findMany({ where: { active: true }, include: { balances: true } });

  let totalInventoryMt = 0;
  const materialRows = materials.map((m) => {
    const currentStock = m.balances.reduce((s, b) => s + b.quantity, 0);
    if (m.uom === "MT") totalInventoryMt += currentStock;
    const { status, reason } = classifyStockStatus({ currentStock, minStock: m.minStock, safetyStock: m.safetyStock });
    return { material: m, currentStock, status, reason };
  });

  const critical = materialRows.filter((r) => r.status === "CRITICAL");
  const low = materialRows.filter((r) => r.status === "LOW");

  const siloRows = locations
    .filter((l) => l.capacity != null)
    .map((l) => {
      const total = l.balances.reduce((s, b) => s + b.quantity, 0);
      const fillPct = l.capacity ? (total / l.capacity) * 100 : 0;
      const remaining = (l.capacity ?? 0) - total;
      return { location: l, total, fillPct, capacityRemaining: remaining, truckloadsRemaining: Math.max(0, Math.floor(remaining / TRUCKLOAD_MT)) };
    })
    .sort((a, b) => b.fillPct - a.fillPct);

  const highFillSilos = siloRows.filter((s) => s.fillPct >= 90);

  const [openRequests, urgentOpenRequests, recentMovements] = await Promise.all([
    prisma.stockRequest.count({ where: { status: { in: ["PENDING", "ACCEPTED", "ALLOCATED", "IN_TRANSIT", "PARTIALLY_RECEIVED"] } } }),
    prisma.stockRequest.findMany({ where: { status: { in: ["PENDING", "ACCEPTED", "ALLOCATED", "IN_TRANSIT", "PARTIALLY_RECEIVED"] }, priority: "URGENT" }, include: { material: true }, orderBy: { requiredByDate: "asc" } }),
    prisma.inventoryTransaction.findMany({
      include: { material: true, sourceLocation: true, destinationLocation: true },
      orderBy: { timestamp: "desc" },
      take: 12,
    }),
  ]);

  // 14-day trend: total on-hand tonnage and daily consumption, for the 2 dashboard charts.
  const since = new Date();
  since.setDate(since.getDate() - 14);
  since.setHours(0, 0, 0, 0);
  const [inboundTx, outboundTx, consumptionTx] = await Promise.all([
    prisma.inventoryTransaction.findMany({ where: { timestamp: { gte: since }, destinationLocationId: { not: null }, material: { uom: "MT" } }, select: { quantity: true, timestamp: true } }),
    prisma.inventoryTransaction.findMany({ where: { timestamp: { gte: since }, sourceLocationId: { not: null }, material: { uom: "MT" } }, select: { quantity: true, timestamp: true } }),
    prisma.inventoryTransaction.findMany({ where: { timestamp: { gte: since }, transactionType: "CONSUMPTION" }, select: { quantity: true, timestamp: true } }),
  ]);
  const netByDay = new Map<string, number>();
  const consumptionByDay = new Map<string, number>();
  for (const t of inboundTx) netByDay.set(t.timestamp.toISOString().slice(0, 10), (netByDay.get(t.timestamp.toISOString().slice(0, 10)) ?? 0) + t.quantity);
  for (const t of outboundTx) netByDay.set(t.timestamp.toISOString().slice(0, 10), (netByDay.get(t.timestamp.toISOString().slice(0, 10)) ?? 0) - t.quantity);
  for (const t of consumptionTx) consumptionByDay.set(t.timestamp.toISOString().slice(0, 10), (consumptionByDay.get(t.timestamp.toISOString().slice(0, 10)) ?? 0) + t.quantity);

  const trend: { date: string; stockMt: number; consumptionMt: number }[] = [];
  let running = totalInventoryMt;
  for (let i = 0; i <= 14; i++) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    trend.unshift({ date: key, stockMt: Math.max(0, running), consumptionMt: consumptionByDay.get(key) ?? 0 });
    running -= netByDay.get(key) ?? 0;
  }

  return {
    kpi: { totalInventoryMt, criticalCount: critical.length, lowCount: low.length, openRequestsCount: openRequests },
    materialRows,
    critical,
    low,
    siloRows,
    highFillSilos,
    urgentOpenRequests,
    recentMovements,
    trend,
  };
}
