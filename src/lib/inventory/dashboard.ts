import { prisma } from "@/lib/db";
import { classifyStockStatus } from "@/lib/inventory/status";
import { IN_TRANSIT_LOCATION_TYPE, OPEN_REQUEST_STATUSES } from "@/lib/domain/enums";
import { formatQty } from "@/lib/format";

const TRUCKLOAD_MT = 30; // configurable approximation for "truckloads remaining"

export interface AttentionItem {
  kind: "critical" | "low" | "exception";
  href: string;
  title: string;
  subtitle: string;
  line1: string;
  line2: string;
  badgeLabel: string;
}

export async function getDashboardData() {
  // Every balances include below excludes the virtual "In Transit (Internal)" location —
  // material mid-delivery isn't on hand anywhere yet, so it must never inflate a displayed
  // total. This must stay consistent with getTotalOnHand() (balance.ts), which the Material
  // Detail page uses, or the same material would show a different number on different screens.
  const materials = await prisma.material.findMany({
    where: { active: true },
    include: { balances: { where: { location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } } } },
  });
  const locations = await prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, include: { balances: true } });

  // One batched query for every material's QC Hold/Blocked quantities — avoids an N+1
  // getUnrestrictedAvailable() call per material. Status classification below uses this so
  // QC Hold/Blocked stock can't make a material look falsely HEALTHY/LOW here either.
  const qualityBalances = await prisma.qualityBalance.findMany({ where: { materialId: { in: materials.map((m) => m.id) } } });
  const nonUnrestrictedByMaterial = new Map<string, number>();
  for (const q of qualityBalances) nonUnrestrictedByMaterial.set(q.materialId, (nonUnrestrictedByMaterial.get(q.materialId) ?? 0) + q.quantity);

  let totalInventoryMt = 0;
  const materialRows = materials.map((m) => {
    const currentStock = m.balances.reduce((s, b) => s + b.quantity, 0);
    if (m.uom === "MT") totalInventoryMt += currentStock;
    const unrestrictedStock = Math.max(0, currentStock - (nonUnrestrictedByMaterial.get(m.id) ?? 0));
    const { status, reason } = classifyStockStatus({ currentStock: unrestrictedStock, minStock: m.minStock, safetyStock: m.safetyStock });
    return { material: m, currentStock, unrestrictedStock, status, reason };
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

  const [openRequests, urgentOpenRequests, notReceivedRequests, openStatusRows, recentMovements, inTransitBalances] = await Promise.all([
    prisma.stockRequest.count({ where: { status: { in: OPEN_REQUEST_STATUSES } } }),
    prisma.stockRequest.findMany({ where: { status: { in: OPEN_REQUEST_STATUSES }, priority: "URGENT" }, include: { material: true }, orderBy: { requiredByDate: "asc" } }),
    // The one true "something went wrong" state in the lifecycle — delivered, but the requester
    // says it never arrived. Needs a supervisor to investigate and re-arrange, so it's the
    // request-side half of "Exceptions" (materials are the stock-side half).
    prisma.stockRequest.findMany({ where: { status: "NOT_RECEIVED" }, include: { material: true }, orderBy: { notReceivedAt: "desc" } }),
    prisma.stockRequest.findMany({ where: { status: { in: OPEN_REQUEST_STATUSES } }, select: { status: true } }),
    prisma.inventoryTransaction.findMany({
      include: { material: true, sourceLocation: true, destinationLocation: true },
      orderBy: { timestamp: "desc" },
      take: 12,
    }),
    prisma.inventoryBalance.findMany({ where: { location: { type: IN_TRANSIT_LOCATION_TYPE } }, include: { material: true } }),
  ]);

  const totalInTransitMt = inTransitBalances.filter((b) => b.material.uom === "MT").reduce((s, b) => s + b.quantity, 0);

  const REQUEST_STATUS_LABELS: Record<string, string> = {
    NEW_REQUEST: "New",
    ACCEPTED: "Accepted",
    ASSIGNED: "Assigned",
    IN_TRANSIT: "In Transit",
    DELIVERED: "Delivered",
    NOT_RECEIVED: "Not Received",
    PARTIALLY_RECEIVED: "Partially Received",
  };
  const statusCounts = new Map<string, number>();
  for (const r of openStatusRows) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  const requestsByStatus = OPEN_REQUEST_STATUSES.filter((s) => (statusCounts.get(s) ?? 0) > 0).map((s) => ({
    status: s,
    label: REQUEST_STATUS_LABELS[s] ?? s,
    count: statusCounts.get(s) ?? 0,
  }));

  // Combined "needs attention" feed: stock exceptions (critical/low) and request exceptions
  // (not received) in one unified list, critical first.
  const needsAttention: AttentionItem[] = [
    ...critical.map((r) => ({
      kind: "critical" as const,
      href: `/inventory/${r.material.id}`,
      title: r.material.name,
      subtitle: "Material",
      line1: `${formatQty(r.unrestrictedStock, r.material.uom)} available`,
      line2: r.material.safetyStock != null ? `Safety Stock: ${formatQty(r.material.safetyStock, r.material.uom)}` : "Below safety stock",
      badgeLabel: "CRITICAL",
    })),
    ...notReceivedRequests.map((req) => ({
      kind: "exception" as const,
      href: `/requests/${req.id}`,
      title: req.requestNumber,
      subtitle: `${req.material.name} | ${formatQty(req.quantityRequested, req.material.uom)}`,
      line1: "Awaiting action",
      line2: "Not Received",
      badgeLabel: "EXCEPTION",
    })),
    ...low.map((r) => ({
      kind: "low" as const,
      href: `/inventory/${r.material.id}`,
      title: r.material.name,
      subtitle: "Material",
      line1: `${formatQty(r.unrestrictedStock, r.material.uom)} available`,
      line2: r.material.minStock != null ? `Minimum Stock: ${formatQty(r.material.minStock, r.material.uom)}` : "Below minimum stock",
      badgeLabel: "LOW",
    })),
  ];

  // 30-day consumption per material, batched — feeds the Days of Cover watchlist below without
  // an N+1 computeDaysOfCover() call per material.
  const since30 = new Date();
  since30.setDate(since30.getDate() - 30);
  const consumption30 = await prisma.inventoryTransaction.findMany({
    where: { transactionType: "CONSUMPTION", timestamp: { gte: since30 } },
    select: { materialId: true, quantity: true },
  });
  const consumption30ByMaterial = new Map<string, number>();
  for (const c of consumption30) consumption30ByMaterial.set(c.materialId, (consumption30ByMaterial.get(c.materialId) ?? 0) + c.quantity);

  // "Stock Requiring Attention" — sorted by soonest-to-run-out (Days of Cover), not just
  // current threshold status, so a HEALTHY material that's burning down fast still shows up
  // before it becomes a problem. Materials with no consumption history have no rate to sort
  // by, so they're excluded here (they still show up in the main Inventory list).
  const stockWatchlist = materialRows
    .map((r) => {
      const dailyRate = (consumption30ByMaterial.get(r.material.id) ?? 0) / 30;
      const daysCover = dailyRate > 1e-9 ? r.unrestrictedStock / dailyRate : null;
      return { material: r.material, currentStock: r.currentStock, status: r.status, daysCover };
    })
    .filter((r): r is typeof r & { daysCover: number } => r.daysCover != null)
    .sort((a, b) => a.daysCover - b.daysCover)
    .slice(0, 6);

  // 14-day trend: total on-hand tonnage and daily consumption, for the 2 dashboard charts.
  const since = new Date();
  since.setDate(since.getDate() - 14);
  since.setHours(0, 0, 0, 0);
  // A TRANSFER_OUT/TRANSFER_IN row has both a real leg and a virtual in-transit leg on the
  // SAME row — excluding the virtual side here (not just from the balances above) keeps these
  // deltas honest: TRANSFER_OUT is a pure decrease to on-hand total, TRANSFER_IN a pure
  // increase, instead of netting to a false zero as if the material never left real inventory.
  const [inboundTx, outboundTx, consumptionTx] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where: { timestamp: { gte: since }, destinationLocationId: { not: null }, destinationLocation: { type: { not: IN_TRANSIT_LOCATION_TYPE } }, material: { uom: "MT" } },
      select: { quantity: true, timestamp: true },
    }),
    prisma.inventoryTransaction.findMany({
      where: { timestamp: { gte: since }, sourceLocationId: { not: null }, sourceLocation: { type: { not: IN_TRANSIT_LOCATION_TYPE } }, material: { uom: "MT" } },
      select: { quantity: true, timestamp: true },
    }),
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
    kpi: {
      totalInventoryMt,
      criticalCount: critical.length,
      lowCount: low.length,
      openRequestsCount: openRequests,
      totalInTransitMt,
      exceptionsCount: notReceivedRequests.length,
    },
    materialRows,
    critical,
    low,
    siloRows,
    highFillSilos,
    urgentOpenRequests,
    notReceivedRequests,
    requestsByStatus,
    needsAttention,
    stockWatchlist,
    recentMovements,
    trend,
  };
}
