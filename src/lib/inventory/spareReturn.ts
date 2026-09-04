import { prisma } from "@/lib/db";
import { postMovement } from "@/lib/inventory/ledger";
import { changeQualityStatus } from "@/lib/inventory/quality";
import type { ReturnCondition } from "@/lib/domain/enums";

export class SpareReturnError extends Error {}

function generateReturnReference() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `RET-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/**
 * `deliveredQuantity` (not `quantityRequested`/`receivedQuantity`) is the correct "issued so
 * far" figure for an ISSUE-purpose request — it's the cumulative amount actually moved out via
 * postMovement/CONSUMPTION in startDelivery(). `receivedQuantity` for ISSUE purpose is just a
 * closing acknowledgement counter with no ledger effect, not what was physically handed out.
 */
export async function getIssuedRemainingForRequest(requestId: string) {
  const request = await prisma.stockRequest.findUniqueOrThrow({ where: { id: requestId } });
  const returned = await prisma.spareReturn.aggregate({ where: { requestId }, _sum: { quantity: true } });
  const alreadyReturned = returned._sum.quantity ?? 0;
  return { issued: request.deliveredQuantity, alreadyReturned, remaining: Math.max(0, request.deliveredQuantity - alreadyReturned) };
}

/**
 * A spare return posts through the existing ledger/quality mechanisms — no new spare ledger,
 * no direct balance edits. It's a stock-in (RECEIPT), followed by the existing quality-status
 * posting when the returned condition isn't immediately usable (UNUSED/SERVICEABLE stay
 * Unrestricted; FOR_INSPECTION/DAMAGED move into QC Hold/Blocked) — on-hand always increases
 * (the item physically came back), only *usable* (Unrestricted) stock is gated by condition.
 * The one addition over the plain ledger/quality mechanism is SpareReturn itself: the durable
 * record + the hard link back to the originating Spare Issue, replacing what used to be a
 * free-text `reference` match with a real foreign key and a server-enforced quantity cap.
 */
export async function postSpareReturn(input: {
  requestId: string;
  materialId: string;
  locationId: string;
  quantity: number;
  condition: ReturnCondition;
  returnedBy: string;
  reason?: string;
  remarks?: string;
  userId: string;
}) {
  if (input.quantity <= 0) throw new SpareReturnError("Return quantity must be greater than zero");
  if (!input.returnedBy?.trim()) throw new SpareReturnError("Returned by is required");

  const material = await prisma.material.findUniqueOrThrow({ where: { id: input.materialId } });
  if (material.category !== "SPARE") throw new SpareReturnError(`${material.name} is not a spare`);

  const request = await prisma.stockRequest.findUniqueOrThrow({ where: { id: input.requestId } });
  if (request.requestType !== "SPARE" || request.purpose !== "ISSUE") {
    throw new SpareReturnError("The selected request is not a spare issue");
  }
  if (request.materialId !== input.materialId) {
    throw new SpareReturnError("The selected request is for a different spare");
  }

  const { remaining } = await getIssuedRemainingForRequest(input.requestId);
  if (input.quantity > remaining + 1e-6) {
    throw new SpareReturnError(`Return quantity cannot exceed the ${remaining} still outstanding for ${request.requestNumber}`);
  }

  const returnReference = generateReturnReference();
  const reason = `Returned by ${input.returnedBy} — Condition: ${input.condition}${input.remarks ? ` — ${input.remarks}` : ""}`;
  const transaction = await postMovement({
    materialId: input.materialId,
    transactionType: "RECEIPT",
    quantity: input.quantity,
    uom: material.uom,
    locationId: input.locationId,
    reference: returnReference,
    reason,
    userId: input.userId,
  });

  // UNUSED/SERVICEABLE stay Unrestricted (derived, never a stored QualityBalance row) — the
  // plain stock-in above is the whole story. FOR_INSPECTION/DAMAGED additionally move the
  // just-received quantity into the existing QC Hold/Blocked buckets, so usable (Unrestricted)
  // stock does not increase even though on-hand does.
  if (input.condition === "FOR_INSPECTION") {
    await changeQualityStatus({
      materialId: input.materialId,
      locationId: input.locationId,
      quantity: input.quantity,
      fromStatus: "UNRESTRICTED",
      toStatus: "QC_HOLD",
      userId: input.userId,
      reason: "Returned — awaiting inspection",
      reference: returnReference,
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
      reference: returnReference,
    });
  }

  return prisma.spareReturn.create({
    data: {
      returnReference,
      requestId: input.requestId,
      originalIssueReference: request.requestNumber,
      materialId: input.materialId,
      quantity: input.quantity,
      locationId: input.locationId,
      returnedBy: input.returnedBy,
      processedByUserId: input.userId,
      condition: input.condition,
      reason: input.reason,
      remarks: input.remarks,
      inventoryTransactionId: transaction.id,
    },
  });
}
