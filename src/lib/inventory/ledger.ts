import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { OUTBOUND_TX_TYPES, INBOUND_TX_TYPES, IN_TRANSIT_LOCATION_TYPE, type TransactionType } from "@/lib/domain/enums";

const IN_TRANSIT_LOCATION_NAME = "In Transit (Internal)";

/** The single system location representing stock issued from a request but not yet received. Not user-creatable. */
export async function getOrCreateInTransitLocation() {
  const existing = await prisma.location.findFirst({ where: { type: IN_TRANSIT_LOCATION_TYPE } });
  if (existing) return existing;
  return prisma.location.create({ data: { name: IN_TRANSIT_LOCATION_NAME, type: IN_TRANSIT_LOCATION_TYPE } });
}

export class InventoryError extends Error {}

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Applies a signed quantity delta to the materialized InventoryBalance row for
 * (materialId, locationId), creating it if absent. This is the single
 * enforcement point for two data-integrity rules: no negative balances, and no
 * receipt/transfer/production silently overfilling a capacity-limited location
 * (silos, bunkers) — both are rejected here unless explicitly overridden.
 */
async function applyBalanceDelta(
  db: Tx,
  args: { materialId: string; locationId: string; delta: number; allowNegative?: boolean; allowOverCapacity?: boolean }
) {
  const { materialId, locationId, delta, allowNegative, allowOverCapacity } = args;
  const [existing, location] = await Promise.all([
    db.inventoryBalance.findUnique({ where: { materialId_locationId: { materialId, locationId } } }),
    db.location.findUniqueOrThrow({ where: { id: locationId } }),
  ]);
  const nextQty = (existing?.quantity ?? 0) + delta;
  if (nextQty < -1e-6 && !allowNegative) {
    throw new InventoryError(
      `Insufficient stock at ${location.name}: has ${(existing?.quantity ?? 0).toLocaleString()}, this movement needs ${(-delta).toLocaleString()}.`
    );
  }
  if (location.capacity != null && nextQty > location.capacity + 1e-6 && !allowOverCapacity) {
    throw new InventoryError(
      `${location.name} capacity would be exceeded: ${nextQty.toLocaleString()} > ${location.capacity.toLocaleString()} capacity.`
    );
  }
  if (existing) {
    await db.inventoryBalance.update({ where: { id: existing.id }, data: { quantity: nextQty } });
  } else {
    await db.inventoryBalance.create({ data: { materialId, locationId, quantity: nextQty } });
  }
}

export interface PostMovementInput {
  materialId: string;
  transactionType: TransactionType;
  quantity: number; // always positive magnitude; direction is implied by transactionType
  uom: string;
  locationId: string;
  timestamp?: Date;
  reference?: string;
  processName?: string;
  reason?: string;
  batchLot?: string;
  userId?: string;
  allowNegative?: boolean;
  allowOverCapacity?: boolean;
}

/**
 * Posts a single-location movement (receipt, consumption, production, dispatch,
 * opening balance). For transfers between two locations use postTransfer, and
 * for packing (bulk -> bagged) use postPacking below.
 */
export async function postMovement(input: PostMovementInput) {
  if (input.quantity <= 0) throw new InventoryError("quantity must be greater than zero");
  const isOutbound = OUTBOUND_TX_TYPES.includes(input.transactionType);
  const isInbound = INBOUND_TX_TYPES.includes(input.transactionType);
  if (!isOutbound && !isInbound) {
    throw new InventoryError(`${input.transactionType} is not a single-location movement — use postTransfer/postPacking/postAdjustment instead`);
  }
  const balanceDelta = isOutbound ? -input.quantity : input.quantity;

  return prisma.$transaction(async (db) => {
    const record = await db.inventoryTransaction.create({
      data: {
        materialId: input.materialId,
        transactionType: input.transactionType,
        quantity: input.quantity,
        uom: input.uom,
        timestamp: input.timestamp ?? new Date(),
        sourceLocationId: isOutbound ? input.locationId : undefined,
        destinationLocationId: isInbound ? input.locationId : undefined,
        reference: input.reference,
        processName: input.processName,
        reason: input.reason,
        batchLot: input.batchLot,
        userId: input.userId,
      },
    });

    await applyBalanceDelta(db, {
      materialId: input.materialId,
      locationId: input.locationId,
      delta: balanceDelta,
      allowNegative: input.allowNegative,
      allowOverCapacity: input.allowOverCapacity,
    });

    return record;
  });
}

/** Signed adjustment (positive or negative) with a mandatory reason. Never a direct stock edit — always ledgered. */
export async function postAdjustment(input: {
  materialId: string;
  locationId: string;
  quantity: number; // signed
  uom: string;
  reason: string;
  userId?: string;
  timestamp?: Date;
  reference?: string;
}) {
  if (!input.reason?.trim()) throw new InventoryError("An adjustment requires a reason");
  if (input.quantity === 0) throw new InventoryError("Adjustment quantity cannot be zero");

  return prisma.$transaction(async (db) => {
    const record = await db.inventoryTransaction.create({
      data: {
        materialId: input.materialId,
        transactionType: "ADJUSTMENT",
        quantity: Math.abs(input.quantity),
        uom: input.uom,
        timestamp: input.timestamp ?? new Date(),
        sourceLocationId: input.quantity < 0 ? input.locationId : undefined,
        destinationLocationId: input.quantity >= 0 ? input.locationId : undefined,
        reason: input.reason,
        reference: input.reference,
        userId: input.userId,
      },
    });
    await applyBalanceDelta(db, {
      materialId: input.materialId,
      locationId: input.locationId,
      delta: input.quantity,
      allowNegative: true,
      allowOverCapacity: true, // a correcting adjustment must always be postable
    });
    return record;
  });
}

/** Transfer between two plant locations — one atomic ledger row, both sides updated together. */
export async function postTransfer(input: {
  materialId: string;
  quantity: number;
  uom: string;
  sourceLocationId: string;
  destinationLocationId: string;
  timestamp?: Date;
  reference?: string;
  userId?: string;
}) {
  if (input.quantity <= 0) throw new InventoryError("quantity must be greater than zero");
  if (input.sourceLocationId === input.destinationLocationId) {
    throw new InventoryError("Source and destination locations must be different");
  }

  return prisma.$transaction(async (db) => {
    const record = await db.inventoryTransaction.create({
      data: {
        materialId: input.materialId,
        transactionType: "TRANSFER",
        quantity: input.quantity,
        uom: input.uom,
        timestamp: input.timestamp ?? new Date(),
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        reference: input.reference,
        userId: input.userId,
      },
    });
    await applyBalanceDelta(db, { materialId: input.materialId, locationId: input.sourceLocationId, delta: -input.quantity });
    await applyBalanceDelta(db, { materialId: input.materialId, locationId: input.destinationLocationId, delta: input.quantity });
    return record;
  });
}

/**
 * Leg 1 of a request-driven internal movement: moves stock from the source location
 * into the shared "In Transit (Internal)" location. Used by requests.ts's issueStock —
 * NOT the same as postTransfer, which moves stock in one atomic instant hop with no
 * in-transit visibility.
 */
export async function postTransferOut(input: {
  materialId: string;
  quantity: number;
  uom: string;
  sourceLocationId: string;
  timestamp?: Date;
  reference?: string;
  userId?: string;
}) {
  if (input.quantity <= 0) throw new InventoryError("quantity must be greater than zero");
  const inTransit = await getOrCreateInTransitLocation();

  return prisma.$transaction(async (db) => {
    const record = await db.inventoryTransaction.create({
      data: {
        materialId: input.materialId,
        transactionType: "TRANSFER_OUT",
        quantity: input.quantity,
        uom: input.uom,
        timestamp: input.timestamp ?? new Date(),
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: inTransit.id,
        reference: input.reference,
        userId: input.userId,
      },
    });
    await applyBalanceDelta(db, { materialId: input.materialId, locationId: input.sourceLocationId, delta: -input.quantity });
    await applyBalanceDelta(db, { materialId: input.materialId, locationId: inTransit.id, delta: input.quantity });
    return record;
  });
}

/** Leg 2: moves stock from the shared in-transit location into the final destination. */
export async function postTransferIn(input: {
  materialId: string;
  quantity: number;
  uom: string;
  destinationLocationId: string;
  timestamp?: Date;
  reference?: string;
  userId?: string;
}) {
  if (input.quantity <= 0) throw new InventoryError("quantity must be greater than zero");
  const inTransit = await getOrCreateInTransitLocation();

  return prisma.$transaction(async (db) => {
    const record = await db.inventoryTransaction.create({
      data: {
        materialId: input.materialId,
        transactionType: "TRANSFER_IN",
        quantity: input.quantity,
        uom: input.uom,
        timestamp: input.timestamp ?? new Date(),
        sourceLocationId: inTransit.id,
        destinationLocationId: input.destinationLocationId,
        reference: input.reference,
        userId: input.userId,
      },
    });
    await applyBalanceDelta(db, { materialId: input.materialId, locationId: inTransit.id, delta: -input.quantity });
    await applyBalanceDelta(db, { materialId: input.materialId, locationId: input.destinationLocationId, delta: input.quantity });
    return record;
  });
}

/**
 * Packing converts bulk finished-goods stock into bagged stock of the same
 * tonnage plus consumption of bag packing material. Bag count is never stored
 * — it's always derived from (bagged tonnage / bagWeightKg) at read time, so
 * bag count and tonnage can never drift apart.
 */
export async function postPacking(input: {
  bulkMaterialId: string;
  bulkLocationId: string;
  bulkQuantity: number; // MT
  bagMaterialId: string; // packing material (Nos)
  bagLocationId: string;
  baggedMaterialId: string; // finished bagged material (MT)
  baggedLocationId: string;
  timestamp?: Date;
  userId?: string;
}) {
  if (input.bulkQuantity <= 0) throw new InventoryError("bulk quantity must be positive");

  return prisma.$transaction(async (db) => {
    const baggedMaterial = await db.material.findUniqueOrThrow({ where: { id: input.baggedMaterialId } });
    if (!baggedMaterial.bagWeightKg) throw new InventoryError("bagged material must define bagWeightKg");
    const bagsNeeded = Math.round((input.bulkQuantity * 1000) / baggedMaterial.bagWeightKg);
    const timestamp = input.timestamp ?? new Date();

    await db.inventoryTransaction.create({
      data: { materialId: input.bulkMaterialId, transactionType: "PACKING", quantity: input.bulkQuantity, uom: "MT", timestamp, sourceLocationId: input.bulkLocationId, userId: input.userId },
    });
    await db.inventoryTransaction.create({
      data: { materialId: input.bagMaterialId, transactionType: "PACKING", quantity: bagsNeeded, uom: "Nos", timestamp, sourceLocationId: input.bagLocationId, userId: input.userId },
    });
    await db.inventoryTransaction.create({
      data: { materialId: input.baggedMaterialId, transactionType: "PACKING", quantity: input.bulkQuantity, uom: "MT", timestamp, destinationLocationId: input.baggedLocationId, userId: input.userId },
    });

    await applyBalanceDelta(db, { materialId: input.bulkMaterialId, locationId: input.bulkLocationId, delta: -input.bulkQuantity });
    await applyBalanceDelta(db, { materialId: input.bagMaterialId, locationId: input.bagLocationId, delta: -bagsNeeded });
    await applyBalanceDelta(db, { materialId: input.baggedMaterialId, locationId: input.baggedLocationId, delta: input.bulkQuantity });

    return { bagsNeeded };
  });
}

/** Derive bag count for a bagged material balance — never stored, so it can't drift from tonnage. */
export function deriveBagCount(tonnage: number, bagWeightKg: number | null | undefined) {
  if (!bagWeightKg) return null;
  return Math.round((tonnage * 1000) / bagWeightKg);
}
