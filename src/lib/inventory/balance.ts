import { prisma } from "@/lib/db";
import { IN_TRANSIT_LOCATION_TYPE } from "@/lib/domain/enums";

/** On-hand stock for a material at a single location. */
export async function getLocationOnHand(materialId: string, locationId: string) {
  const row = await prisma.inventoryBalance.findUnique({ where: { materialId_locationId: { materialId, locationId } } });
  return row?.quantity ?? 0;
}

/**
 * Total ON HAND stock for a material across every real location — deliberately
 * excludes the virtual in-transit location, since material in transit isn't
 * available anywhere yet (that's the whole point of the request lifecycle's
 * IN_TRANSIT state). Used for status classification (LOW/CRITICAL) and KPIs.
 */
export async function getTotalOnHand(materialId: string) {
  const rows = await prisma.inventoryBalance.findMany({ where: { materialId, location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } } });
  return rows.reduce((sum, r) => sum + r.quantity, 0);
}

/** Balance broken down by every real (non-virtual) location holding a material. */
export async function getLocationBalances(materialId: string) {
  return prisma.inventoryBalance.findMany({
    where: { materialId, quantity: { gt: 1e-6 }, location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } },
    include: { location: true },
    orderBy: { quantity: "desc" },
  });
}

/** Total quantity of a material currently in transit (issued but not yet received), network-wide. */
export async function getTotalInTransit(materialId: string) {
  const row = await prisma.inventoryBalance.findFirst({ where: { materialId, location: { type: IN_TRANSIT_LOCATION_TYPE } } });
  return row?.quantity ?? 0;
}

/** Reserved (allocated-but-not-issued) quantity for a material at a location, from active reservations. */
export async function getReservedQuantity(materialId: string, locationId: string) {
  const result = await prisma.stockReservation.aggregate({
    where: { materialId, locationId, status: "ACTIVE" },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

/** On Hand / Reserved / Available for a material at a location — Available = On Hand − Reserved. */
export async function getStockLevels(materialId: string, locationId: string) {
  const [onHand, reserved] = await Promise.all([getLocationOnHand(materialId, locationId), getReservedQuantity(materialId, locationId)]);
  return { onHand, reserved, available: onHand - reserved };
}

/**
 * Reconstructs the balance as of `asOfDate` purely from the transaction ledger —
 * proves traceability independent of the materialized InventoryBalance cache.
 * Every ledger row stores a positive magnitude with direction implied by which
 * location field is populated, so balance = Σ(dest rows) − Σ(source rows).
 */
export async function reconstructBalanceFromLedger(materialId: string, locationId: string, asOfDate?: Date) {
  const [inbound, outbound] = await Promise.all([
    prisma.inventoryTransaction.aggregate({
      where: { materialId, destinationLocationId: locationId, ...(asOfDate ? { timestamp: { lte: asOfDate } } : {}) },
      _sum: { quantity: true },
    }),
    prisma.inventoryTransaction.aggregate({
      where: { materialId, sourceLocationId: locationId, ...(asOfDate ? { timestamp: { lte: asOfDate } } : {}) },
      _sum: { quantity: true },
    }),
  ]);
  return (inbound._sum.quantity ?? 0) - (outbound._sum.quantity ?? 0);
}
