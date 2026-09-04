import { prisma } from "@/lib/db";
import { postMovement } from "@/lib/inventory/ledger";
import { changeQualityStatus } from "@/lib/inventory/quality";
import type { ReturnCondition } from "@/lib/domain/enums";

export class SpareReturnError extends Error {}

/**
 * A spare return posts through the existing ledger/quality mechanisms — no new tables, no
 * "SPI-" reference series. It's a stock-in (RECEIPT) linked to the original request by
 * `reference`, followed by the existing quality-status posting when the returned condition
 * isn't immediately usable. Never mutates the original issue transaction — corrections to a
 * return use the existing audited adjustment, same as everywhere else in this app.
 */
export async function postSpareReturn(input: {
  materialId: string;
  locationId: string;
  quantity: number;
  condition: ReturnCondition;
  returnedBy: string;
  relatedRequestNumber?: string;
  remarks?: string;
  userId: string;
}) {
  if (input.quantity <= 0) throw new SpareReturnError("Return quantity must be greater than zero");
  if (!input.returnedBy?.trim()) throw new SpareReturnError("Returned by is required");

  const material = await prisma.material.findUniqueOrThrow({ where: { id: input.materialId } });
  if (material.category !== "SPARE") throw new SpareReturnError(`${material.name} is not a spare`);

  const reason = `Returned by ${input.returnedBy} — Condition: ${input.condition}${input.remarks ? ` — ${input.remarks}` : ""}`;
  const transaction = await postMovement({
    materialId: input.materialId,
    transactionType: "RECEIPT",
    quantity: input.quantity,
    uom: material.uom,
    locationId: input.locationId,
    reference: input.relatedRequestNumber,
    reason,
    userId: input.userId,
  });

  // UNUSED/SERVICEABLE stay Unrestricted (derived, never a stored QualityBalance row) — the
  // plain stock-in above is the whole story. FOR_INSPECTION/DAMAGED additionally move the
  // just-received quantity into the existing QC Hold/Blocked buckets.
  if (input.condition === "FOR_INSPECTION") {
    await changeQualityStatus({
      materialId: input.materialId,
      locationId: input.locationId,
      quantity: input.quantity,
      fromStatus: "UNRESTRICTED",
      toStatus: "QC_HOLD",
      userId: input.userId,
      reason: "Returned — awaiting inspection",
      reference: input.relatedRequestNumber,
    });
  } else if (input.condition === "DAMAGED") {
    await changeQualityStatus({
      materialId: input.materialId,
      locationId: input.locationId,
      quantity: input.quantity,
      fromStatus: "UNRESTRICTED",
      toStatus: "BLOCKED",
      userId: input.userId,
      reason: "Returned damaged",
      reference: input.relatedRequestNumber,
    });
  }

  return transaction;
}

/** Cumulative quantity already returned against a request (by reference), for the over-return warn-and-confirm check. */
export async function getReturnedQuantityForRequest(requestNumber: string) {
  const result = await prisma.inventoryTransaction.aggregate({
    where: { transactionType: "RECEIPT", reference: requestNumber, reason: { contains: "Returned by" } },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}
