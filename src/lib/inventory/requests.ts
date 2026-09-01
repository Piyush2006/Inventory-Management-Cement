import { prisma } from "@/lib/db";
import { postTransferOut, postTransferIn } from "@/lib/inventory/ledger";
import { getStockLevels } from "@/lib/inventory/balance";
import { requireRole, PermissionError } from "@/lib/auth";
import { FULFILMENT_ROLES } from "@/lib/domain/enums";
import type { RequestEventAction } from "@/lib/domain/enums";

export class RequestError extends Error {}

function generateRequestNumber() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `REQ-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function logEvent(input: {
  stockRequestId: string;
  action: RequestEventAction;
  userId: string;
  role: string;
  quantity?: number;
  fromLocationId?: string;
  toLocationId?: string;
  reason?: string;
}) {
  await prisma.requestEvent.create({ data: input });
}

export async function createStockRequest(input: {
  materialId: string;
  quantityRequested: number;
  requiredByDate: Date;
  priority?: "NORMAL" | "URGENT";
  reason?: string;
  note?: string;
  fromLocationId: string;
  toLocationId: string;
  requestedByUserId: string;
}) {
  if (input.quantityRequested <= 0) throw new RequestError("Requested quantity must be greater than zero");
  const requester = await prisma.user.findUniqueOrThrow({ where: { id: input.requestedByUserId } });
  if (input.fromLocationId === input.toLocationId) throw new RequestError("From and To locations must be different");

  const request = await prisma.stockRequest.create({
    data: {
      requestNumber: generateRequestNumber(),
      materialId: input.materialId,
      quantityRequested: input.quantityRequested,
      requiredByDate: input.requiredByDate,
      priority: input.priority ?? "NORMAL",
      reason: input.reason,
      note: input.note,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      requestedByUserId: requester.id,
      requestedByRole: requester.role,
      status: "PENDING",
    },
  });
  await logEvent({ stockRequestId: request.id, action: "REQUEST_RAISED", userId: requester.id, role: requester.role, quantity: input.quantityRequested, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId, reason: input.reason });
  return request;
}

async function getRequestOrThrow(id: string) {
  return prisma.stockRequest.findUniqueOrThrow({ where: { id } });
}

export async function acceptStockRequest(requestId: string, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, FULFILMENT_ROLES);
  const request = await getRequestOrThrow(requestId);
  if (request.status !== "PENDING") throw new RequestError(`Only a PENDING request can be accepted (this one is ${request.status})`);

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "ACCEPTED", acceptedByUserId: user.id, acceptedAt: new Date() } });
  await logEvent({ stockRequestId: requestId, action: "ACCEPTED", userId: user.id, role: user.role });
  return updated;
}

export async function rejectStockRequest(requestId: string, actingUserId: string, reason: string) {
  if (!reason?.trim()) throw new RequestError("A rejection reason is required");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, FULFILMENT_ROLES);
  const request = await getRequestOrThrow(requestId);
  if (request.status !== "PENDING") throw new RequestError(`Only a PENDING request can be rejected (this one is ${request.status})`);

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "REJECTED", rejectedByUserId: user.id, rejectedAt: new Date(), rejectionReason: reason } });
  await logEvent({ stockRequestId: requestId, action: "REJECTED", userId: user.id, role: user.role, reason });
  return updated;
}

/** Only the requester who raised it can cancel, and only while it's still PENDING. */
export async function cancelStockRequest(requestId: string, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  const request = await getRequestOrThrow(requestId);
  if (request.requestedByUserId !== user.id) throw new PermissionError("Only the requester who raised this request can cancel it");
  if (request.status !== "PENDING") throw new RequestError(`Only a PENDING request can be cancelled (this one is ${request.status})`);

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
  await logEvent({ stockRequestId: requestId, action: "CANCELLED", userId: user.id, role: user.role });
  return updated;
}

/**
 * Reserves stock at the request's From Location without moving anything physically —
 * On Hand is unchanged, but Available (On Hand − Reserved) drops. Can run again from
 * PARTIALLY_RECEIVED to allocate the next round of a multi-batch fulfilment; never
 * allocates more than the still-unallocated remainder of the requested quantity.
 */
export async function allocateStock(requestId: string, quantity: number, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, FULFILMENT_ROLES);
  const request = await getRequestOrThrow(requestId);
  if (request.status !== "ACCEPTED" && request.status !== "PARTIALLY_RECEIVED") {
    throw new RequestError(`Cannot allocate stock for a request with status ${request.status}`);
  }
  if (quantity <= 0) throw new RequestError("Allocation quantity must be greater than zero");
  const remainingToAllocate = request.quantityRequested - request.allocatedQuantity;
  if (quantity > remainingToAllocate + 1e-6) {
    throw new RequestError(`Cannot allocate ${quantity} — only ${remainingToAllocate} of the requested quantity remains unallocated.`);
  }

  const levels = await getStockLevels(request.materialId, request.fromLocationId);
  if (quantity > levels.available + 1e-6) {
    throw new RequestError(`Insufficient available stock at the source location: ${levels.available.toLocaleString()} available (On Hand ${levels.onHand.toLocaleString()} − Reserved ${levels.reserved.toLocaleString()}).`);
  }

  await prisma.stockReservation.create({ data: { stockRequestId: requestId, materialId: request.materialId, locationId: request.fromLocationId, quantity, status: "ACTIVE" } });
  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { allocatedQuantity: request.allocatedQuantity + quantity, status: "ALLOCATED" } });
  await logEvent({ stockRequestId: requestId, action: "ALLOCATED", userId: user.id, role: user.role, quantity, fromLocationId: request.fromLocationId });
  return updated;
}

/**
 * Physically moves the currently-allocated (reserved) quantity out of the source
 * location into the shared in-transit location, releasing the reservation it consumes.
 * Destination On Hand does NOT increase yet — that only happens on confirmReceipt.
 */
export async function issueStock(requestId: string, quantity: number, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, FULFILMENT_ROLES);
  const request = await getRequestOrThrow(requestId);
  if (request.status !== "ALLOCATED") throw new RequestError(`Cannot issue stock for a request with status ${request.status}`);
  if (quantity <= 0) throw new RequestError("Issue quantity must be greater than zero");

  const activeReserved = request.allocatedQuantity - request.issuedQuantity;
  if (quantity > activeReserved + 1e-6) {
    throw new RequestError(`Cannot issue ${quantity} — only ${activeReserved} is currently allocated and unissued.`);
  }

  const material = await prisma.material.findUniqueOrThrow({ where: { id: request.materialId } });
  await postTransferOut({ materialId: request.materialId, quantity, uom: material.uom, sourceLocationId: request.fromLocationId, reference: request.requestNumber, userId: user.id });

  // This simplified demo releases the whole active reservation for the request when any
  // portion is issued — supporting a partial issue of a single allocation batch would need
  // per-reservation quantity splitting, which isn't needed for the lifecycle this enhancement covers.
  await prisma.stockReservation.updateMany({ where: { stockRequestId: requestId, status: "ACTIVE" }, data: { status: "RELEASED", releasedAt: new Date() } });

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { issuedQuantity: request.issuedQuantity + quantity, status: "IN_TRANSIT" } });
  await logEvent({ stockRequestId: requestId, action: "ISSUED", userId: user.id, role: user.role, quantity, fromLocationId: request.fromLocationId ?? undefined, toLocationId: request.toLocationId });
  return updated;
}

/**
 * The requester confirms physical receipt at the To Location: moves stock from the
 * in-transit location into destination On Hand. Auto-completes the request once the
 * full requested quantity has been received; otherwise leaves it PARTIALLY_RECEIVED
 * so another allocate/issue/receive round can run.
 */
export async function confirmReceipt(requestId: string, quantity: number, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, ["REQUESTER"]);
  const request = await getRequestOrThrow(requestId);
  if (request.requestedByUserId !== user.id) throw new PermissionError("Only the requester who raised this request can confirm receipt of it");
  if (request.status !== "IN_TRANSIT") throw new RequestError(`Cannot confirm receipt for a request with status ${request.status}`);
  if (quantity <= 0) throw new RequestError("Received quantity must be greater than zero");

  const inTransitForRequest = request.issuedQuantity - request.receivedQuantity;
  if (quantity > inTransitForRequest + 1e-6) {
    throw new RequestError(`Cannot receive ${quantity} — only ${inTransitForRequest} is currently in transit for this request.`);
  }

  const material = await prisma.material.findUniqueOrThrow({ where: { id: request.materialId } });
  await postTransferIn({ materialId: request.materialId, quantity, uom: material.uom, destinationLocationId: request.toLocationId, reference: request.requestNumber, userId: user.id });

  const newReceived = request.receivedQuantity + quantity;
  const isComplete = newReceived >= request.quantityRequested - 1e-6;
  const updated = await prisma.stockRequest.update({
    where: { id: requestId },
    data: { receivedQuantity: newReceived, status: isComplete ? "COMPLETED" : "PARTIALLY_RECEIVED", completedAt: isComplete ? new Date() : undefined },
  });
  await logEvent({ stockRequestId: requestId, action: isComplete ? "RECEIVED" : "PARTIALLY_RECEIVED", userId: user.id, role: user.role, quantity, toLocationId: request.toLocationId });
  if (isComplete) await logEvent({ stockRequestId: requestId, action: "COMPLETED", userId: user.id, role: user.role });
  return updated;
}

/**
 * Pre-flight check for the external-replenishment path — call this BEFORE posting a
 * GRN's ledger transaction, so a rejected external receipt never leaves an orphaned,
 * unlinked movement (same principle as the internal lifecycle's own guards).
 */
export async function assertExternalReceiptAllowed(requestId: string, quantity: number) {
  const request = await getRequestOrThrow(requestId);
  if (!["PENDING", "ACCEPTED", "PARTIALLY_RECEIVED"].includes(request.status)) {
    throw new RequestError(`Cannot apply an external receipt to a request with status ${request.status}`);
  }
  const remaining = request.quantityRequested - request.receivedQuantity;
  if (quantity > remaining + 1e-6) {
    throw new RequestError(`External receipt quantity (${quantity}) exceeds the remaining requested quantity (${remaining}).`);
  }
  return request;
}

/**
 * External-replenishment path (see procurement.ts): a Material Receipt/GRN linked to
 * this request was posted, so its accepted quantity fulfils the request directly —
 * bypassing allocate/issue/in-transit entirely, since the material never came from an
 * internal location. Same request ID stays attached throughout, per spec.
 */
export async function applyExternalReceipt(input: { requestId: string; quantity: number; actingUserId: string }) {
  const request = await assertExternalReceiptAllowed(input.requestId, input.quantity);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.actingUserId } });
  const newReceived = request.receivedQuantity + input.quantity;
  const isComplete = newReceived >= request.quantityRequested - 1e-6;
  const updated = await prisma.stockRequest.update({
    where: { id: request.id },
    data: { receivedQuantity: newReceived, status: isComplete ? "COMPLETED" : "PARTIALLY_RECEIVED", completedAt: isComplete ? new Date() : undefined },
  });
  await logEvent({ stockRequestId: request.id, action: isComplete ? "RECEIVED" : "PARTIALLY_RECEIVED", userId: user.id, role: user.role, quantity: input.quantity, reason: "Received via external Material Receipt / GRN" });
  if (isComplete) await logEvent({ stockRequestId: request.id, action: "COMPLETED", userId: user.id, role: user.role });
  return updated;
}
