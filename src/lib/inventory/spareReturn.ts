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
 *
 * Sums every SpareReturn against this request regardless of status (REPORTED or COMPLETED) —
 * a return that's been reported but not yet completed already claims part of what was issued,
 * so it must count against "remaining eligible to return" too, or the same physical item could
 * be reported twice before the Store ever processes the first report.
 */
export async function getIssuedRemainingForRequest(requestId: string) {
  const request = await prisma.stockRequest.findUniqueOrThrow({ where: { id: requestId } });
  const returned = await prisma.spareReturn.aggregate({ where: { requestId }, _sum: { quantity: true } });
  const alreadyReturned = returned._sum.quantity ?? 0;
  return { issued: request.deliveredQuantity, alreadyReturned, remaining: Math.max(0, request.deliveredQuantity - alreadyReturned) };
}

async function validateAgainstRequest(input: { requestId: string; materialId: string; quantity: number }) {
  if (input.quantity <= 0) throw new SpareReturnError("Return quantity must be greater than zero");

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

  return { material, request };
}

/**
 * Stage 1 of the Spare Return workflow — a Requester/Maintenance user (or a Store Operator on
 * the fast path below) declares that a spare is being returned. No inventory effect yet: no
 * location, no verified condition, no ledger entry. Only completeSpareReturn (stage 2) moves
 * stock, matching "receiving the return does NOT require Store Supervisor approval, but only
 * the Store Operator's completion actually changes inventory."
 */
export async function reportSpareReturn(input: {
  requestId: string;
  materialId: string;
  quantity: number;
  returnedBy: string;
  reportedByUserId: string;
  reason?: string;
  remarks?: string;
}) {
  if (!input.returnedBy?.trim()) throw new SpareReturnError("Returned by is required");
  const { request } = await validateAgainstRequest(input);

  return prisma.spareReturn.create({
    data: {
      returnReference: generateReturnReference(),
      requestId: input.requestId,
      originalIssueReference: request.requestNumber,
      materialId: input.materialId,
      quantity: input.quantity,
      status: "REPORTED",
      returnedBy: input.returnedBy,
      reportedByUserId: input.reportedByUserId,
      reason: input.reason,
      remarks: input.remarks,
    },
  });
}

/**
 * Stage 2 — a Store Operator (or Admin) receives a previously-reported return, inspects it, and
 * completes it: picks the receiving location and records the verified condition. This is the
 * only point a Spare Return actually posts through the ledger/quality mechanisms — a stock-in
 * (RECEIPT), followed by the existing quality-status posting when the condition isn't
 * immediately usable (UNUSED/SERVICEABLE stay Unrestricted; FOR_INSPECTION/DAMAGED move into QC
 * Hold/Blocked) — on-hand always increases (the item physically came back), only *usable*
 * (Unrestricted) stock is gated by condition, exactly as the original single-step flow did.
 */
export async function completeSpareReturn(input: {
  spareReturnId: string;
  locationId: string;
  condition: ReturnCondition;
  processedByUserId: string;
}) {
  const spareReturn = await prisma.spareReturn.findUnique({ where: { id: input.spareReturnId }, include: { material: true } });
  if (!spareReturn) throw new SpareReturnError("Spare return not found");
  if (spareReturn.status !== "REPORTED") throw new SpareReturnError("This return has already been completed");

  const reason = `Returned by ${spareReturn.returnedBy} — Condition: ${input.condition}${spareReturn.remarks ? ` — ${spareReturn.remarks}` : ""}`;
  const transaction = await postMovement({
    materialId: spareReturn.materialId,
    transactionType: "RECEIPT",
    quantity: spareReturn.quantity,
    uom: spareReturn.material.uom,
    locationId: input.locationId,
    reference: spareReturn.returnReference,
    reason,
    userId: input.processedByUserId,
  });

  if (input.condition === "FOR_INSPECTION") {
    await changeQualityStatus({
      materialId: spareReturn.materialId,
      locationId: input.locationId,
      quantity: spareReturn.quantity,
      fromStatus: "UNRESTRICTED",
      toStatus: "QC_HOLD",
      userId: input.processedByUserId,
      reason: "Returned — awaiting inspection",
      reference: spareReturn.returnReference,
    });
  } else if (input.condition === "DAMAGED") {
    await changeQualityStatus({
      materialId: spareReturn.materialId,
      locationId: input.locationId,
      quantity: spareReturn.quantity,
      fromStatus: "UNRESTRICTED",
      toStatus: "BLOCKED",
      userId: input.processedByUserId,
      reason: "Returned damaged",
      reference: spareReturn.returnReference,
    });
  }

  return prisma.spareReturn.update({
    where: { id: spareReturn.id },
    data: {
      status: "COMPLETED",
      locationId: input.locationId,
      condition: input.condition,
      processedByUserId: input.processedByUserId,
      inventoryTransactionId: transaction.id,
      completedAt: new Date(),
    },
  });
}

/**
 * Fast path for a Store Operator (or Admin) receiving a spare that was never separately
 * reported — a walk-in return handed over in person. Reports and completes in the same
 * request; identical net effect to reportSpareReturn immediately followed by
 * completeSpareReturn, just without the intermediate "pending" state to hand off.
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
  const reported = await reportSpareReturn({
    requestId: input.requestId,
    materialId: input.materialId,
    quantity: input.quantity,
    returnedBy: input.returnedBy,
    reportedByUserId: input.userId,
    reason: input.reason,
    remarks: input.remarks,
  });
  return completeSpareReturn({
    spareReturnId: reported.id,
    locationId: input.locationId,
    condition: input.condition,
    processedByUserId: input.userId,
  });
}
