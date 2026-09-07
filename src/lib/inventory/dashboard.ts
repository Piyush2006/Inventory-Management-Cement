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

const MAX_FLOW_LOOKBACK_DAYS = 366;

export async function getDashboardData(flowStartDate?: Date, flowEndDate?: Date) {
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

  // Inventory Movement — a single material's own daily flow (opening -> received -> consumed
  // -> dispatched -> transferred out -> closing) across the last 14 days, replacing the two
  // separate network-wide trend charts with one richer per-material view. Every category comes
  // straight off the existing signed ledger convention (positive magnitude, direction implied by
  // which of sourceLocationId/destinationLocationId is set — same as everywhere else in this
  // app): RECEIPT/TRANSFER_IN/OPENING_BALANCE are inward, CONSUMPTION/DISPATCH/TRANSFER_OUT are
  // outward, ADJUSTMENT is signed by which side is set. The plain same-material TRANSFER type is
  // deliberately excluded — it moves stock between two real locations of the SAME material, so it
  // nets to zero for total on-hand and isn't a real inward/outward event.
  // Resolves to an explicit [start, end] date pair (both inclusive, end never past today — there's
  // no future data to show). The walk below always starts from today's real current stock and
  // steps backward through every day since `start`, regardless of where `end` falls, then the
  // displayed series is sliced down to [start, end] — so picking an end date in the past still
  // anchors correctly to a real, live balance rather than a guessed one.
  const endDate = flowEndDate ? new Date(flowEndDate) : new Date(todayStart);
  endDate.setHours(0, 0, 0, 0);
  if (endDate.getTime() > todayStart.getTime()) endDate.setTime(todayStart.getTime());

  const defaultStart = new Date(todayStart);
  defaultStart.setDate(defaultStart.getDate() - 13);
  const startDate = flowStartDate ? new Date(flowStartDate) : defaultStart;
  startDate.setHours(0, 0, 0, 0);
  if (startDate.getTime() > endDate.getTime()) startDate.setTime(endDate.getTime());
  const earliestAllowed = new Date(todayStart);
  earliestAllowed.setDate(earliestAllowed.getDate() - MAX_FLOW_LOOKBACK_DAYS);
  if (startDate.getTime() < earliestAllowed.getTime()) startDate.setTime(earliestAllowed.getTime());

  const lookbackDays = Math.round((todayStart.getTime() - startDate.getTime()) / 86400000);
  const endDateKey = endDate.toISOString().slice(0, 10);

  const flowTx = await prisma.inventoryTransaction.findMany({
    where: {
      timestamp: { gte: startDate },
      transactionType: { in: ["RECEIPT", "TRANSFER_IN", "OPENING_BALANCE", "CONSUMPTION", "DISPATCH", "TRANSFER_OUT", "ADJUSTMENT"] },
    },
    select: { materialId: true, transactionType: true, quantity: true, timestamp: true, sourceLocationId: true, destinationLocationId: true },
  });

  interface DayBucket { received: number; consumed: number; dispatched: number; transferredOut: number; adjusted: number }
  function emptyBucket(): DayBucket {
    return { received: 0, consumed: 0, dispatched: 0, transferredOut: 0, adjusted: 0 };
  }
  // materialId -> "YYYY-MM-DD" -> bucket
  const currentByMaterialDay = new Map<string, Map<string, DayBucket>>();

  for (const t of flowTx) {
    const dayKey = t.timestamp.toISOString().slice(0, 10);
    let byDay = currentByMaterialDay.get(t.materialId);
    if (!byDay) { byDay = new Map(); currentByMaterialDay.set(t.materialId, byDay); }
    let bucket = byDay.get(dayKey);
    if (!bucket) { bucket = emptyBucket(); byDay.set(dayKey, bucket); }

    if (t.transactionType === "RECEIPT" || t.transactionType === "TRANSFER_IN" || t.transactionType === "OPENING_BALANCE") {
      bucket.received += t.quantity;
    } else if (t.transactionType === "CONSUMPTION") {
      bucket.consumed += t.quantity;
    } else if (t.transactionType === "DISPATCH") {
      bucket.dispatched += t.quantity;
    } else if (t.transactionType === "TRANSFER_OUT") {
      bucket.transferredOut += t.quantity;
    } else if (t.transactionType === "ADJUSTMENT") {
      bucket.adjusted += t.destinationLocationId ? t.quantity : -t.quantity;
    }
  }

  const currentStockByMaterial = new Map(materialRows.map((r) => [r.material.id, r.currentStock]));

  interface FlowDay { date: string; opening: number; received: number; consumed: number; dispatched: number; transferredOut: number; adjusted: number; closing: number }
  const seriesByMaterial: Record<string, FlowDay[]> = {};
  const heartbeatScoreByMaterial = new Map<string, number>();
  let defaultMaterialId: string | null = null;
  let defaultMaterialActivity = -1;

  for (const m of materials) {
    const byDay = currentByMaterialDay.get(m.id);
    const allDays: FlowDay[] = [];
    // Walk backward from today's real current stock (already known) so every closing value in
    // the series is anchored to a real, live balance — never a guessed/derived starting point —
    // then slice down to the requested [startDate, endDate] window below.
    let closing = currentStockByMaterial.get(m.id) ?? 0;
    for (let i = 0; i <= lookbackDays; i++) {
      const d = new Date(todayStart);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const bucket = byDay?.get(key) ?? emptyBucket();
      // Floored at 0 — on-hand stock is never negative. Without this, a long custom lookback
      // range can walk far enough back that cumulative historical outflows exceed today's real
      // balance, which would otherwise surface as a physically impossible negative "opening".
      const opening = Math.max(0, closing - bucket.received + bucket.consumed + bucket.dispatched + bucket.transferredOut - bucket.adjusted);
      allDays.unshift({ date: key, opening, ...bucket, closing });
      closing = opening;
    }
    const days = allDays.filter((d) => d.date <= endDateKey);
    seriesByMaterial[m.id] = days;

    const activity = days.reduce((s, d) => s + d.received + d.consumed + d.dispatched, 0);
    if (activity > defaultMaterialActivity) {
      defaultMaterialActivity = activity;
      defaultMaterialId = m.id;
    }

    // "Good heartbeat" = most days with a genuine up-then-down movement (a receipt AND an
    // outflow on the same day), not just raw volume — a material with one huge spike scores
    // lower here than one with a steady daily zigzag, which is what actually reads well on
    // the chart. Ties broken by total activity.
    const heartbeatDays = days.filter((d) => d.received > 1e-6 && (d.consumed > 1e-6 || d.dispatched > 1e-6)).length;
    heartbeatScoreByMaterial.set(m.id, heartbeatDays * 1e6 + activity);
  }

  const sortedMaterials = [...materials].sort((a, b) => (heartbeatScoreByMaterial.get(b.id) ?? 0) - (heartbeatScoreByMaterial.get(a.id) ?? 0));

  const materialFlow = {
    materials: sortedMaterials.map((m) => ({ id: m.id, name: m.name, uom: m.uom })),
    defaultMaterialId: defaultMaterialId ?? materials[0]?.id ?? null,
    seriesByMaterial,
    range: { start: startDate.toISOString().slice(0, 10), end: endDateKey, maxDate: todayStart.toISOString().slice(0, 10) },
  };

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
    materialFlow,
  };
}
