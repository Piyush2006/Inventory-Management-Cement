import { prisma } from "@/lib/db";
import { postTransferOut, postTransferIn } from "@/lib/inventory/ledger";
import { reconcileQualityBalances } from "@/lib/inventory/quality";
import { requireRole, PermissionError } from "@/lib/auth";
import { ACCEPT_REJECT_ROLES, ROUTE_ROLES, ASSIGN_ROLES, OPERATOR_ROLES, ADMIN_ROLE } from "@/lib/domain/enums";
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

async function getRequestOrThrow(id: string) {
  return prisma.stockRequest.findUniqueOrThrow({ where: { id } });
}

/** Requester creates a request. Different people, not the requester, will accept/assign/deliver it. */
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
  if (input.fromLocationId === input.toLocationId) throw new RequestError("From and To locations must be different");

  const [requester, material, fromLocation, toLocation] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: input.requestedByUserId } }),
    prisma.material.findUniqueOrThrow({ where: { id: input.materialId } }),
    prisma.location.findUniqueOrThrow({ where: { id: input.fromLocationId } }),
    prisma.location.findUniqueOrThrow({ where: { id: input.toLocationId } }),
  ]);
  if (!material.active) throw new RequestError("Material is not active");
  if (!fromLocation.active || !toLocation.active) throw new RequestError("From and To locations must be active");

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
      status: "NEW_REQUEST",
    },
  });
  await logEvent({ stockRequestId: request.id, action: "REQUEST_CREATED", userId: requester.id, role: requester.role, quantity: input.quantityRequested, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId, reason: input.reason });
  return request;
}

/** Inventory Manager's first operational decision: accept a new request. */
export async function acceptStockRequest(requestId: string, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, ACCEPT_REJECT_ROLES);
  const request = await getRequestOrThrow(requestId);
  if (request.status !== "NEW_REQUEST") throw new RequestError(`Only a NEW_REQUEST can be accepted (this one is ${request.status})`);

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "ACCEPTED", acceptedByUserId: user.id, acceptedAt: new Date() } });
  await logEvent({ stockRequestId: requestId, action: "ACCEPTED", userId: user.id, role: user.role });
  return updated;
}

/** Inventory Manager rejects a new request. Rejected requests remain visible in history with their reason. */
export async function rejectStockRequest(requestId: string, actingUserId: string, reason: string) {
  if (!reason?.trim()) throw new RequestError("A rejection reason is required");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, ACCEPT_REJECT_ROLES);
  const request = await getRequestOrThrow(requestId);
  if (request.status !== "NEW_REQUEST") throw new RequestError(`Only a NEW_REQUEST can be rejected (this one is ${request.status})`);

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "REJECTED", rejectedByUserId: user.id, rejectedAt: new Date(), rejectionReason: reason } });
  await logEvent({ stockRequestId: requestId, action: "REJECTED", userId: user.id, role: user.role, reason });
  return updated;
}

// Both routeToSupervisor and assignOperator are reachable from the same set of statuses:
// ACCEPTED (first round), PARTIALLY_RECEIVED / NOT_RECEIVED (re-arrange for the next round,
// same Request ID — never a new request), or ASSIGNED itself (re-route/re-assign before
// delivery has started).
const ROUTE_OR_ASSIGN_VALID_FROM = ["ACCEPTED", "PARTIALLY_RECEIVED", "NOT_RECEIVED", "ASSIGNED"];

/**
 * Inventory Manager's second step, before anyone picks an operator: hand the request to one
 * specific Store Supervisor. Only that Supervisor (not just any Supervisor) can then call
 * assignOperator below. Re-callable to redirect to a different Supervisor — it doesn't touch
 * status, so it can't undo progress an operator has already made.
 */
export async function routeToSupervisor(requestId: string, supervisorUserId: string, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, ROUTE_ROLES);
  const request = await getRequestOrThrow(requestId);
  if (!ROUTE_OR_ASSIGN_VALID_FROM.includes(request.status)) {
    throw new RequestError(`Cannot route a request with status ${request.status}`);
  }

  const supervisor = await prisma.user.findUniqueOrThrow({ where: { id: supervisorUserId } });
  requireRole(supervisor, ["STORE_SUPERVISOR"]);

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { routedToUserId: supervisor.id, routedByUserId: user.id, routedAt: new Date() } });
  await logEvent({ stockRequestId: requestId, action: "ROUTED", userId: user.id, role: user.role, reason: `Routed to ${supervisor.name}` });
  return updated;
}

/**
 * The routed-to Store Supervisor assigns a specific Store/Delivery Operator to carry out
 * delivery. Requires the request to have already been routed to a Supervisor (routeToSupervisor
 * above) — and, unless the actor is Admin, requires the acting Supervisor to be the one it was
 * routed to, not just any Supervisor. Reserves whatever quantity still needs to physically move
 * for this round — On Hand is unchanged, but Available (On Hand − Reserved) drops, so no other
 * request can double-book it.
 */
export async function assignOperator(requestId: string, operatorUserId: string, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, ASSIGN_ROLES);
  const request = await getRequestOrThrow(requestId);
  if (!ROUTE_OR_ASSIGN_VALID_FROM.includes(request.status)) {
    throw new RequestError(`Cannot assign an operator for a request with status ${request.status}`);
  }
  if (user.role !== ADMIN_ROLE) {
    if (!request.routedToUserId) {
      throw new RequestError("This request must be routed to a Store Supervisor before an operator can be assigned");
    }
    if (request.routedToUserId !== user.id) {
      throw new PermissionError("Only the Store Supervisor this request was routed to can assign an operator");
    }
  }

  const operator = await prisma.user.findUniqueOrThrow({ where: { id: operatorUserId } });
  requireRole(operator, OPERATOR_ROLES);

  // Validation disabled for now, per explicit request — assignment no longer checks available
  // stock at the source location. A reservation is still recorded either way (still drives the
  // Reserved/Available figures elsewhere), but it's no longer a gate on whether Assign succeeds.
  const remainingToMove = request.quantityRequested - request.deliveredQuantity;
  if (request.status !== "ASSIGNED" && remainingToMove > 1e-6) {
    await prisma.stockReservation.create({ data: { stockRequestId: requestId, materialId: request.materialId, locationId: request.fromLocationId, quantity: remainingToMove, status: "ACTIVE" } });
  }

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "ASSIGNED", assignedToUserId: operator.id, assignedByUserId: user.id, assignedAt: new Date() } });
  await logEvent({ stockRequestId: requestId, action: "ASSIGNED", userId: user.id, role: user.role, quantity: remainingToMove > 1e-6 ? remainingToMove : undefined, fromLocationId: request.fromLocationId, toLocationId: request.toLocationId, reason: `Assigned to ${operator.name}` });
  return updated;
}

/**
 * The assigned operator starts delivery: physically moves whatever quantity is still
 * outstanding for this round out of the source location into the shared in-transit
 * location, releasing the reservation it consumes. If nothing new needs to move (e.g.
 * re-attempting delivery after NOT_RECEIVED, where the material never came back) this
 * still transitions the status but posts no additional ledger movement.
 */
export async function startDelivery(requestId: string, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, OPERATOR_ROLES);
  const request = await getRequestOrThrow(requestId);
  if (request.assignedToUserId !== user.id && user.role !== ADMIN_ROLE) throw new PermissionError("Only the assigned operator can start delivery for this request");
  if (request.status !== "ASSIGNED") throw new RequestError(`Cannot start delivery for a request with status ${request.status}`);

  const quantity = request.quantityRequested - request.deliveredQuantity;
  if (quantity > 1e-6) {
    const material = await prisma.material.findUniqueOrThrow({ where: { id: request.materialId } });
    await postTransferOut({ materialId: request.materialId, quantity, uom: material.uom, sourceLocationId: request.fromLocationId, reference: request.requestNumber, userId: user.id });
    // postTransferOut's source leg allows negative on hand (stock-sufficiency validation is
    // deliberately disabled on this path) — if the source had QC Hold/Blocked stock recorded,
    // On Hand can now sit below it. Self-corrects rather than gating this frozen path.
    await reconcileQualityBalances(request.materialId, request.fromLocationId);
    await prisma.stockReservation.updateMany({ where: { stockRequestId: requestId, status: "ACTIVE" }, data: { status: "RELEASED", releasedAt: new Date() } });
  }

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { deliveredQuantity: request.deliveredQuantity + quantity, status: "IN_TRANSIT" } });
  await logEvent({ stockRequestId: requestId, action: "IN_TRANSIT", userId: user.id, role: user.role, quantity, fromLocationId: request.fromLocationId, toLocationId: request.toLocationId });
  return updated;
}

/**
 * The assigned operator marks the material as physically delivered to the destination.
 * This does NOT complete the request and does NOT move any stock — the material is
 * already sitting in the in-transit bucket. Only the requester's own confirmation closes it.
 */
export async function markDelivered(requestId: string, actingUserId: string, deliveryNote?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, OPERATOR_ROLES);
  const request = await getRequestOrThrow(requestId);
  if (request.assignedToUserId !== user.id && user.role !== ADMIN_ROLE) throw new PermissionError("Only the assigned operator can mark this request delivered");
  if (request.status !== "IN_TRANSIT") throw new RequestError(`Cannot mark delivered for a request with status ${request.status}`);

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "DELIVERED", deliveredByUserId: user.id, deliveredAt: new Date(), deliveryNote } });
  const inTransitForRound = request.deliveredQuantity - request.receivedQuantity;
  await logEvent({ stockRequestId: requestId, action: "DELIVERED", userId: user.id, role: user.role, quantity: inTransitForRound, toLocationId: request.toLocationId, reason: deliveryNote });
  return updated;
}

/**
 * The original requester confirms physical receipt: moves stock from the in-transit
 * bucket into destination On Hand. Auto-completes once the full requested quantity has
 * been received; otherwise leaves the same request PARTIALLY_RECEIVED so the supervisor
 * can arrange the remaining quantity — never a new Request ID.
 */
export async function confirmReceipt(requestId: string, quantity: number, actingUserId: string, note?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, ["REQUESTER", ADMIN_ROLE]);
  const request = await getRequestOrThrow(requestId);
  if (request.requestedByUserId !== user.id && user.role !== ADMIN_ROLE) throw new PermissionError("Only the requester who raised this request can confirm receipt of it");
  if (request.status !== "DELIVERED") throw new RequestError(`Cannot confirm receipt for a request with status ${request.status}`);
  if (quantity <= 0) throw new RequestError("Received quantity must be greater than zero");

  // No validation, per explicit request — confirming more than was ever delivered is allowed.
  const material = await prisma.material.findUniqueOrThrow({ where: { id: request.materialId } });
  await postTransferIn({ materialId: request.materialId, quantity, uom: material.uom, destinationLocationId: request.toLocationId, reference: request.requestNumber, userId: user.id });

  const newReceived = request.receivedQuantity + quantity;
  const isComplete = newReceived >= request.quantityRequested - 1e-6;
  const updated = await prisma.stockRequest.update({
    where: { id: requestId },
    data: { receivedQuantity: newReceived, status: isComplete ? "COMPLETED" : "PARTIALLY_RECEIVED", completedAt: isComplete ? new Date() : undefined },
  });
  await logEvent({ stockRequestId: requestId, action: isComplete ? "RECEIVED" : "PARTIALLY_RECEIVED", userId: user.id, role: user.role, quantity, toLocationId: request.toLocationId, reason: note });
  if (isComplete) await logEvent({ stockRequestId: requestId, action: "COMPLETED", userId: user.id, role: user.role });
  return updated;
}

/**
 * The requester reports that delivered material never actually arrived. This is an
 * exception, not a close — the request moves to the Store Supervisor's exception queue
 * for investigation/re-delivery via assignOperator, keeping the same Request ID.
 */
export async function markNotReceived(requestId: string, actingUserId: string, reason: string) {
  if (!reason?.trim()) throw new RequestError("A reason is required to mark a request as not received");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, ["REQUESTER", ADMIN_ROLE]);
  const request = await getRequestOrThrow(requestId);
  if (request.requestedByUserId !== user.id && user.role !== ADMIN_ROLE) throw new PermissionError("Only the requester who raised this request can report it not received");
  if (request.status !== "DELIVERED") throw new RequestError(`Cannot mark not received for a request with status ${request.status}`);

  const updated = await prisma.stockRequest.update({ where: { id: requestId }, data: { status: "NOT_RECEIVED", notReceivedReason: reason, notReceivedAt: new Date() } });
  await logEvent({ stockRequestId: requestId, action: "NOT_RECEIVED", userId: user.id, role: user.role, reason });
  return updated;
}
