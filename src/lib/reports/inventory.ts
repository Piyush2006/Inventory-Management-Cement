import { prisma } from "@/lib/db";
import { IN_TRANSIT_LOCATION_TYPE } from "@/lib/domain/enums";
import type { ReportFilters } from "./types";

export interface MaterialInventoryRow {
  materialId: string;
  materialName: string;
  category: string;
  uom: string;
  opening: number;
  received: number;
  consumed: number;
  transferIn: number;
  transferOut: number;
  dispatched: number;
  adjustments: number;
  closing: number;
}

const DEFAULT_WINDOW_DAYS = 30;

function isRealLocation(type: string | null | undefined) {
  return !!type && type !== IN_TRANSIT_LOCATION_TYPE;
}

type Bucket = "received" | "consumed" | "transferIn" | "transferOut" | "dispatched" | "adjustments";

// Which within-range column a leg of a given transaction type contributes to. Every
// TransactionType is covered exactly once per leg — this partition is what keeps
// Opening + Received + TransferIn - Consumed - TransferOut - Dispatched + Adjustments = Closing
// exactly true (see getInventoryReport's closing/opening computation, which sums the SAME legs
// with a uniform sign instead of a type-directed bucket).
function bucketForLeg(type: string, isSourceLeg: boolean): Bucket | null {
  if (type === "RECEIPT" || type === "OPENING_BALANCE") return isSourceLeg ? null : "received";
  if (type === "CONSUMPTION") return isSourceLeg ? "consumed" : null;
  if (type === "DISPATCH") return isSourceLeg ? "dispatched" : null;
  if (type === "ADJUSTMENT") return "adjustments";
  if (type === "TRANSFER") return isSourceLeg ? "transferOut" : "transferIn";
  if (type === "TRANSFER_OUT") return isSourceLeg ? "transferOut" : null;
  if (type === "TRANSFER_IN") return isSourceLeg ? null : "transferIn";
  return null;
}

function bump(map: Map<string, number>, key: string, delta: number) {
  map.set(key, (map.get(key) ?? 0) + delta);
}

/**
 * Reconstructs Opening/Closing Stock for an arbitrary date range purely from the existing
 * ledger — there is no historical balance snapshot table, by design (see Reports plan). Every
 * InventoryTransaction row stores a positive-magnitude quantity; direction is which of
 * sourceLocationId/destinationLocationId is populated. Opening/Closing sum that signed delta,
 * one real (non-IN_TRANSIT) leg at a time, independently — a plain TRANSFER row has both a real
 * source leg AND a real destination leg on the SAME row, so both must be evaluated, not
 * if/else'd, or the outbound leg silently disappears and Closing Stock overstates.
 */
export async function getInventoryReport(filters: ReportFilters) {
  const to = filters.to ?? new Date();
  const from = filters.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86400000);

  const materials = await prisma.material.findMany({
    where: { active: true, ...(filters.materialId ? { id: filters.materialId } : {}), ...(filters.category ? { category: filters.category } : {}) },
    orderBy: { name: "asc" },
  });

  const transactions = await prisma.inventoryTransaction.findMany({
    where: {
      timestamp: { lte: to },
      ...(filters.materialId ? { materialId: filters.materialId } : {}),
      ...(filters.locationId ? { OR: [{ sourceLocationId: filters.locationId }, { destinationLocationId: filters.locationId }] } : {}),
    },
    select: {
      materialId: true,
      transactionType: true,
      quantity: true,
      timestamp: true,
      sourceLocationId: true,
      destinationLocationId: true,
      sourceLocation: { select: { type: true } },
      destinationLocation: { select: { type: true } },
    },
  });

  const matchesLocation = (id: string | null) => !filters.locationId || id === filters.locationId;

  const openingByMaterial = new Map<string, number>();
  const closingByMaterial = new Map<string, number>();
  const buckets: Record<Bucket, Map<string, number>> = {
    received: new Map(), consumed: new Map(), transferIn: new Map(), transferOut: new Map(), dispatched: new Map(), adjustments: new Map(),
  };

  for (const t of transactions) {
    const withinRange = t.timestamp >= from; // already <= to via the query
    const beforeFrom = !withinRange;

    if (isRealLocation(t.sourceLocation?.type) && matchesLocation(t.sourceLocationId)) {
      bump(closingByMaterial, t.materialId, -t.quantity);
      if (beforeFrom) bump(openingByMaterial, t.materialId, -t.quantity);
      if (withinRange) {
        const bucket = bucketForLeg(t.transactionType, true);
        if (bucket) bump(buckets[bucket], t.materialId, bucket === "adjustments" ? -t.quantity : t.quantity);
      }
    }
    if (isRealLocation(t.destinationLocation?.type) && matchesLocation(t.destinationLocationId)) {
      bump(closingByMaterial, t.materialId, t.quantity);
      if (beforeFrom) bump(openingByMaterial, t.materialId, t.quantity);
      if (withinRange) {
        const bucket = bucketForLeg(t.transactionType, false);
        if (bucket) bump(buckets[bucket], t.materialId, bucket === "adjustments" ? t.quantity : t.quantity);
      }
    }
  }

  const materialRows: MaterialInventoryRow[] = materials.map((m) => ({
    materialId: m.id,
    materialName: m.name,
    category: m.category,
    uom: m.uom,
    opening: openingByMaterial.get(m.id) ?? 0,
    received: buckets.received.get(m.id) ?? 0,
    consumed: buckets.consumed.get(m.id) ?? 0,
    transferIn: buckets.transferIn.get(m.id) ?? 0,
    transferOut: buckets.transferOut.get(m.id) ?? 0,
    dispatched: buckets.dispatched.get(m.id) ?? 0,
    adjustments: buckets.adjustments.get(m.id) ?? 0,
    closing: closingByMaterial.get(m.id) ?? 0,
  }));

  // Summing raw quantities across materials with different units (MT vs Nos, say) would produce
  // a meaningless total. When the filtered set spans more than one unit, the top-level summary
  // is restricted to the plant's primary unit (MT) — same convention dashboard.ts already uses
  // for its own plant-wide total — and every other-unit material still shows in the table below
  // with its own unit.
  const distinctUoms = [...new Set(materialRows.map((r) => r.uom))];
  const mixedUnits = distinctUoms.length > 1;
  const summaryUom = distinctUoms.length === 1 ? distinctUoms[0] : "MT";
  const summaryRows = mixedUnits ? materialRows.filter((r) => r.uom === summaryUom) : materialRows;

  const summary = summaryRows.reduce(
    (acc, r) => ({
      opening: acc.opening + r.opening,
      received: acc.received + r.received,
      consumed: acc.consumed + r.consumed,
      transferIn: acc.transferIn + r.transferIn,
      transferOut: acc.transferOut + r.transferOut,
      dispatched: acc.dispatched + r.dispatched,
      adjustments: acc.adjustments + r.adjustments,
      closing: acc.closing + r.closing,
    }),
    { opening: 0, received: 0, consumed: 0, transferIn: 0, transferOut: 0, dispatched: 0, adjustments: 0, closing: 0 },
  );

  return { from, to, summary, summaryUom, mixedUnits, materialRows };
}
