import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getLocationOnHand, getTotalOnHand } from "@/lib/inventory/balance";
import { IN_TRANSIT_LOCATION_TYPE, type QualityStatus } from "@/lib/domain/enums";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Applies a signed delta to a (materialId, locationId, status) QualityBalance row, creating it
 * if absent. Mirrors applyBalanceDelta in ledger.ts, minus the negative-balance guard — moving
 * more out of a status than is recorded there is never blocked (no validation, by design); it
 * just clamps at 0 rather than going negative, since a negative QC Hold/Blocked bucket has no
 * meaning.
 */
async function applyQualityDelta(db: Tx, args: { materialId: string; locationId: string; status: "QC_HOLD" | "BLOCKED"; delta: number }) {
  const { materialId, locationId, status, delta } = args;
  const existing = await db.qualityBalance.findUnique({ where: { materialId_locationId_status: { materialId, locationId, status } } });
  const nextQty = (existing?.quantity ?? 0) + delta;
  const clamped = Math.max(0, nextQty);
  if (existing) {
    await db.qualityBalance.update({ where: { id: existing.id }, data: { quantity: clamped } });
  } else if (clamped > 0) {
    await db.qualityBalance.create({ data: { materialId, locationId, status, quantity: clamped } });
  }
}

/**
 * Moves quantity between quality buckets at one location and logs the audit event. The
 * single write path for quality — GRN receipt (UNRESTRICTED -> QC_HOLD/BLOCKED) and manual
 * Release/Hold/Block both call this. UNRESTRICTED itself is never stored (it's derived), so
 * a leg touching UNRESTRICTED only writes the QualityBalance side that actually needs a row.
 */
export async function changeQualityStatus(input: {
  materialId: string;
  locationId: string;
  quantity: number;
  fromStatus: QualityStatus;
  toStatus: QualityStatus;
  userId: string;
  reason?: string;
  reference?: string;
}) {
  if (input.quantity <= 0) throw new Error("Quantity must be greater than zero");
  if (input.fromStatus === input.toStatus) throw new Error("From and to quality status must be different");

  return prisma.$transaction(async (db) => {
    if (input.fromStatus !== "UNRESTRICTED") {
      await applyQualityDelta(db, { materialId: input.materialId, locationId: input.locationId, status: input.fromStatus, delta: -input.quantity });
    }
    if (input.toStatus !== "UNRESTRICTED") {
      await applyQualityDelta(db, { materialId: input.materialId, locationId: input.locationId, status: input.toStatus, delta: input.quantity });
    }
    return db.qualityStatusEvent.create({
      data: {
        materialId: input.materialId,
        locationId: input.locationId,
        quantity: input.quantity,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        userId: input.userId,
        reason: input.reason,
        reference: input.reference,
      },
    });
  });
}

/** QC Hold / Blocked quantities for a material at one location. */
export async function getQualityBalances(materialId: string, locationId: string) {
  const rows = await prisma.qualityBalance.findMany({ where: { materialId, locationId } });
  const qcHold = rows.find((r) => r.status === "QC_HOLD")?.quantity ?? 0;
  const blocked = rows.find((r) => r.status === "BLOCKED")?.quantity ?? 0;
  return { qcHold, blocked };
}

/** Unrestricted (usable) stock at one location — On Hand minus whatever's on QC Hold or Blocked there. Floored at 0 as defense-in-depth against a QualityBalance that (should never, but could) overstate On Hand. */
export async function getUnrestrictedAvailable(materialId: string, locationId: string) {
  const [onHand, { qcHold, blocked }] = await Promise.all([getLocationOnHand(materialId, locationId), getQualityBalances(materialId, locationId)]);
  return Math.max(0, onHand - qcHold - blocked);
}

/** QC Hold / Blocked quantities for a material, network-wide (excludes the virtual in-transit location, matching getTotalOnHand). */
export async function getTotalQualityBalances(materialId: string) {
  const rows = await prisma.qualityBalance.findMany({ where: { materialId, location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } } });
  const qcHold = rows.filter((r) => r.status === "QC_HOLD").reduce((s, r) => s + r.quantity, 0);
  const blocked = rows.filter((r) => r.status === "BLOCKED").reduce((s, r) => s + r.quantity, 0);
  return { qcHold, blocked };
}

/** Network-wide unrestricted (usable) stock — the numerator Days of Supply and alerting use instead of raw On Hand. */
export async function getTotalUnrestrictedAvailable(materialId: string) {
  const [onHand, { qcHold, blocked }] = await Promise.all([getTotalOnHand(materialId), getTotalQualityBalances(materialId)]);
  return Math.max(0, onHand - qcHold - blocked);
}

/**
 * Self-correcting guard: some existing, intentionally-ungated paths (postAdjustment with
 * allowNegative/allowOverCapacity, postTransferOut's source leg, a cancelled GRN's reversal)
 * can drop On Hand below what QualityBalance currently claims is on QC Hold/Blocked at that
 * location. Rather than gate those shared, frozen ledger paths, call this right after each of
 * their 4 outer call sites — it shrinks QC_HOLD before BLOCKED down to fit On Hand, logging an
 * auto QualityStatusEvent. Never throws, so it can't reintroduce validation anywhere.
 */
export async function reconcileQualityBalances(materialId: string, locationId: string) {
  const [onHand, { qcHold, blocked }] = await Promise.all([getLocationOnHand(materialId, locationId), getQualityBalances(materialId, locationId)]);
  let excess = qcHold + blocked - onHand;
  if (excess <= 1e-6) return;

  const shrinkQcHold = Math.min(qcHold, excess);
  if (shrinkQcHold > 1e-6) {
    await changeQualityStatus({ materialId, locationId, quantity: shrinkQcHold, fromStatus: "QC_HOLD", toStatus: "UNRESTRICTED", userId: "system", reason: "System reconciliation — On Hand dropped below recorded QC Hold" });
    excess -= shrinkQcHold;
  }
  if (excess > 1e-6) {
    const shrinkBlocked = Math.min(blocked, excess);
    if (shrinkBlocked > 1e-6) {
      await changeQualityStatus({ materialId, locationId, quantity: shrinkBlocked, fromStatus: "BLOCKED", toStatus: "UNRESTRICTED", userId: "system", reason: "System reconciliation — On Hand dropped below recorded Blocked" });
    }
  }
}
