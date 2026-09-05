import { prisma } from "@/lib/db";
import { classifyStockStatus } from "@/lib/inventory/status";
import { IN_TRANSIT_LOCATION_TYPE, OPEN_REQUEST_STATUSES } from "@/lib/domain/enums";
import { formatQty } from "@/lib/format";

export interface AttentionItem {
  href: string;
  title: string;
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
    orderBy: { name: "asc" },
  });
  const locations = await prisma.location.findMany({
    where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } },
    include: { balances: true, materialsDefaultHere: true },
  });

  // One batched query for every material's QC Hold/Blocked quantities — avoids an N+1
  // getUnrestrictedAvailable() call per material. Status classification below uses this so
  // QC Hold/Blocked stock can't make a material look falsely HEALTHY here either.
  const qualityBalances = await prisma.qualityBalance.findMany({ where: { materialId: { in: materials.map((m) => m.id) } } });
  const nonUnrestrictedByMaterial = new Map<string, number>();
  for (const q of qualityBalances) nonUnrestrictedByMaterial.set(q.materialId, (nonUnrestrictedByMaterial.get(q.materialId) ?? 0) + q.quantity);

  let totalInventoryMt = 0;
  const materialRows = materials.map((m) => {
    const currentStock = m.balances.reduce((s, b) => s + b.quantity, 0);
    if (m.uom === "MT") totalInventoryMt += currentStock;
    const unrestrictedStock = Math.max(0, currentStock - (nonUnrestrictedByMaterial.get(m.id) ?? 0));
    const { status } = classifyStockStatus({ currentStock: unrestrictedStock, minStock: m.minStock });
    return { material: m, currentStock, unrestrictedStock, status };
  });

  const critical = materialRows.filter((r) => r.status === "CRITICAL");

  // Silo Quick View is specifically the cement silo vessels, not every capacity-tracked location
  // (yards/bunkers/stores/warehouses/production areas) — Location.type === "SILO" is exactly
  // that set in this plant's data (see prisma/seed.ts), so filtering on the existing type field
  // keeps this generic instead of hardcoding silo names. Fill percentage stays a physical/book
  // reading only — never turned into a HEALTHY/CRITICAL classification, which is decided purely
  // by material-level stock vs. minStock above, independent of how full its silo happens to be.
  const siloRows = locations
    .filter((l) => l.type === "SILO" && l.capacity != null)
    .map((l) => {
      const total = l.balances.reduce((s, b) => s + b.quantity, 0);
      const capacity = l.capacity ?? 0;
      const fillPct = capacity > 0 ? (total / capacity) * 100 : 0;
      const material = l.materialsDefaultHere[0] ?? null;
      return {
        locationId: l.id,
        locationName: l.name,
        materialId: material?.id ?? null,
        materialName: material?.name ?? null,
        uom: l.capacityUom ?? material?.uom ?? "MT",
        total,
        capacity,
        fillPct,
      };
    })
    .sort((a, b) => a.locationName.localeCompare(b.locationName));

  const [openRequests, openStatusRows, inTransitBalances] = await Promise.all([
    prisma.stockRequest.count({ where: { status: { in: OPEN_REQUEST_STATUSES } } }),
    prisma.stockRequest.findMany({ where: { status: { in: OPEN_REQUEST_STATUSES } }, select: { status: true } }),
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

  // Materials below minimum stock (CRITICAL) — the app has only HEALTHY/CRITICAL (see
  // classifyStockStatus), so every row here is CRITICAL; no separate "Low" tier to also show.
  const needsAttention: AttentionItem[] = critical.map((r) => ({
    href: `/inventory/${r.material.id}`,
    title: r.material.name,
    line1: `${formatQty(r.unrestrictedStock, r.material.uom)} available`,
    line2: r.material.minStock != null ? `Minimum Stock: ${formatQty(r.material.minStock, r.material.uom)}` : "Below minimum stock",
    badgeLabel: "CRITICAL",
  }));

  // Dispatched Today — actually left the plant today (status DISPATCHED, dispatchedAt today),
  // not just approved/loading. MT total covers only MT-uom materials (mirrors totalInTransitMt's
  // own uom filter, since summing across different units would be meaningless); the sublabel's
  // dispatch count covers every dispatch today regardless of uom.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dispatchedToday = await prisma.dispatch.findMany({
    where: { status: "DISPATCHED", dispatchedAt: { gte: todayStart } },
    include: { material: true },
  });
  const dispatchedTodayMt = dispatchedToday.filter((d) => d.material.uom === "MT").reduce((s, d) => s + d.quantity, 0);

  // 14-day trend: total on-hand tonnage and daily consumption, for the Inventory/Consumption
  // Trend charts.
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
      openRequestsCount: openRequests,
      totalInTransitMt,
      dispatchedTodayMt,
    },
    critical,
    needsAttention,
    requestsByStatus,
    siloRows,
    trend,
  };
}
