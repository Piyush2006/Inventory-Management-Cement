import { prisma } from "@/lib/db";
import { postMovement } from "@/lib/inventory/ledger";
import { getUnrestrictedAvailable } from "@/lib/inventory/quality";
import { requireRole, PermissionError } from "@/lib/auth";
import { DISPATCH_CREATE_ROLES, DISPATCH_APPROVE_ROLES, DISPATCH_EXECUTE_ROLES, DISPATCH_CANCEL_ROLES, OPERATOR_ROLES } from "@/lib/domain/enums";
import type { DispatchEventAction } from "@/lib/domain/enums";

export class DispatchError extends Error {}

function generateDispatchReference() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `DIS-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function logDispatchEvent(input: { dispatchId: string; action: DispatchEventAction; userId: string; role: string; reason?: string }) {
  await prisma.dispatchEvent.create({ data: input });
}

async function getDispatchOrThrow(id: string) {
  return prisma.dispatch.findUniqueOrThrow({ where: { id } });
}

/**
 * Throws a descriptive DispatchError if quantity exceeds what's Unrestricted at the dispatch's
 * source location — the one enforcement point for "only Unrestricted stock can be dispatched,
 * QC Hold/Blocked must never be eligible." Called fresh at Approve, Start Loading, and again
 * immediately before the DISPATCHED ledger write (not a single reservation lock) — see the
 * Dispatch plan for why: StockReservation's schema is request-specific and this spec's own
 * wording treats reservation as optional, so three live checks close most of the double-booking
 * race without touching that existing model.
 */
async function assertDispatchable(materialId: string, locationId: string, quantity: number, materialName: string, locationName: string, uom: string) {
  const unrestricted = await getUnrestrictedAvailable(materialId, locationId);
  if (quantity > unrestricted + 1e-6) {
    throw new DispatchError(`Only ${unrestricted.toLocaleString()} ${uom} of ${materialName} is Unrestricted at ${locationName} — the rest is on QC Hold or Blocked, or already spoken for.`);
  }
}

/** Store Supervisor / Inventory Manager / Admin raises a Dispatch. No stock check yet — that's the Approval gate below. */
export async function createDispatch(input: {
  materialId: string;
  quantity: number;
  sourceLocationId: string;
  customerDestination: string;
  batchLot?: string;
  weighmentReference?: string;
  notes?: string;
  createdByUserId: string;
}) {
  if (input.quantity <= 0) throw new DispatchError("Quantity must be greater than zero");
  if (!input.customerDestination?.trim()) throw new DispatchError("A customer / destination is required");

  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.createdByUserId } });
  requireRole(user, DISPATCH_CREATE_ROLES);

  const [material, sourceLocation] = await Promise.all([
    prisma.material.findUniqueOrThrow({ where: { id: input.materialId } }),
    prisma.location.findUniqueOrThrow({ where: { id: input.sourceLocationId } }),
  ]);
  if (!material.active) throw new DispatchError("Material is not active");
  if (!sourceLocation.active) throw new DispatchError("Source location is not active");

  const dispatch = await prisma.dispatch.create({
    data: {
      dispatchReference: generateDispatchReference(),
      materialId: input.materialId,
      quantity: input.quantity,
      sourceLocationId: input.sourceLocationId,
      customerDestination: input.customerDestination,
      batchLot: input.batchLot,
      weighmentReference: input.weighmentReference,
      notes: input.notes,
      createdByUserId: user.id,
      status: "CREATED",
    },
  });
  await logDispatchEvent({ dispatchId: dispatch.id, action: "CREATED", userId: user.id, role: user.role });
  return dispatch;
}

/**
 * Approves a CREATED Dispatch and assigns the Store Operator who will execute it, in one step —
 * the spec's Fields list doesn't mention an assignee, but its RBAC section requires Store
 * Operator to see/act on only its *assigned* Dispatches, so approval is where that gets set
 * (mirrors how the Request lifecycle used to combine assignment into one step before routing
 * split it apart). This is also the "Before Approval: validate sufficient Unrestricted stock"
 * gate the spec describes.
 */
export async function approveDispatch(dispatchId: string, assignedOperatorUserId: string, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, DISPATCH_APPROVE_ROLES);
  const dispatch = await getDispatchOrThrow(dispatchId);
  if (dispatch.status !== "CREATED") throw new DispatchError(`Only a CREATED dispatch can be approved (this one is ${dispatch.status})`);

  const operator = await prisma.user.findUniqueOrThrow({ where: { id: assignedOperatorUserId } });
  requireRole(operator, OPERATOR_ROLES);

  const material = await prisma.material.findUniqueOrThrow({ where: { id: dispatch.materialId } });
  const sourceLocation = await prisma.location.findUniqueOrThrow({ where: { id: dispatch.sourceLocationId } });
  await assertDispatchable(dispatch.materialId, dispatch.sourceLocationId, dispatch.quantity, material.name, sourceLocation.name, material.uom);

  const updated = await prisma.dispatch.update({
    where: { id: dispatchId },
    data: { status: "APPROVED", assignedToUserId: operator.id, approvedByUserId: user.id, approvedAt: new Date() },
  });
  await logDispatchEvent({ dispatchId, action: "APPROVED", userId: user.id, role: user.role, reason: `Assigned to ${operator.name}` });
  return updated;
}

/** Re-assign to a different Store Operator while still APPROVED (before loading starts) — the escape hatch for a bad initial assignment. */
export async function reassignDispatchOperator(dispatchId: string, newOperatorUserId: string, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, DISPATCH_APPROVE_ROLES);
  const dispatch = await getDispatchOrThrow(dispatchId);
  if (dispatch.status !== "APPROVED") throw new DispatchError(`Can only reassign a Dispatch while it's APPROVED (this one is ${dispatch.status})`);

  const operator = await prisma.user.findUniqueOrThrow({ where: { id: newOperatorUserId } });
  requireRole(operator, OPERATOR_ROLES);

  const updated = await prisma.dispatch.update({ where: { id: dispatchId }, data: { assignedToUserId: operator.id } });
  await logDispatchEvent({ dispatchId, action: "REASSIGNED", userId: user.id, role: user.role, reason: `Reassigned to ${operator.name}` });
  return updated;
}

function requireDispatchExecutor(user: { id: string; role: string; name: string }, dispatch: { assignedToUserId: string | null }) {
  requireRole(user, DISPATCH_EXECUTE_ROLES);
  // Store Operator is ownership-bound to the specific Dispatch it was assigned; Store
  // Supervisor/Inventory Manager/Admin are not (matches the spec's "Store Supervisor: ...
  // Manage loading ... Mark Dispatch as DISPATCHED" being unqualified).
  if (user.role === "STORE_OPERATOR" && dispatch.assignedToUserId !== user.id) {
    throw new PermissionError("Only the assigned operator can act on this dispatch");
  }
}

/** APPROVED -> LOADING. Re-checks Unrestricted-sufficiency (stock may have moved since Approval). */
export async function startDispatchLoading(dispatchId: string, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  const dispatch = await getDispatchOrThrow(dispatchId);
  requireDispatchExecutor(user, dispatch);
  if (dispatch.status !== "APPROVED") throw new DispatchError(`Cannot start loading for a dispatch with status ${dispatch.status}`);

  const material = await prisma.material.findUniqueOrThrow({ where: { id: dispatch.materialId } });
  const sourceLocation = await prisma.location.findUniqueOrThrow({ where: { id: dispatch.sourceLocationId } });
  await assertDispatchable(dispatch.materialId, dispatch.sourceLocationId, dispatch.quantity, material.name, sourceLocation.name, material.uom);

  const updated = await prisma.dispatch.update({ where: { id: dispatchId }, data: { status: "LOADING", loadingStartedByUserId: user.id, loadingStartedAt: new Date() } });
  await logDispatchEvent({ dispatchId, action: "LOADING_STARTED", userId: user.id, role: user.role });
  return updated;
}

/**
 * LOADING -> DISPATCHED. The only point inventory actually changes — reduces the source
 * location's balance exactly once via the existing ledger mechanism (postMovement with the
 * new DISPATCH transaction type), never at Approve or Start Loading.
 */
export async function markDispatched(dispatchId: string, actingUserId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  const dispatch = await getDispatchOrThrow(dispatchId);
  requireDispatchExecutor(user, dispatch);
  if (dispatch.status !== "LOADING") throw new DispatchError(`Cannot mark dispatched for a dispatch with status ${dispatch.status}`);

  const material = await prisma.material.findUniqueOrThrow({ where: { id: dispatch.materialId } });
  const sourceLocation = await prisma.location.findUniqueOrThrow({ where: { id: dispatch.sourceLocationId } });
  // Final check, immediately before the write — the smallest possible check-then-act window.
  await assertDispatchable(dispatch.materialId, dispatch.sourceLocationId, dispatch.quantity, material.name, sourceLocation.name, material.uom);

  const tx = await postMovement({
    materialId: dispatch.materialId,
    transactionType: "DISPATCH",
    quantity: dispatch.quantity,
    uom: material.uom,
    locationId: dispatch.sourceLocationId,
    reference: dispatch.dispatchReference,
    userId: user.id,
    allowNegative: false, // the one deliberate exception to this app's now-permissive default — see ledger.ts
  });

  const updated = await prisma.dispatch.update({
    where: { id: dispatchId },
    data: { status: "DISPATCHED", dispatchedByUserId: user.id, dispatchedAt: new Date(), inventoryTransactionId: tx.id },
  });
  await logDispatchEvent({ dispatchId, action: "DISPATCHED", userId: user.id, role: user.role });
  return updated;
}

/** Cancel from CREATED/APPROVED/LOADING — never once DISPATCHED. No inventory impact at any of these three states, since nothing has moved yet. */
export async function cancelDispatch(dispatchId: string, actingUserId: string, reason: string) {
  if (!reason?.trim()) throw new DispatchError("A reason is required to cancel a dispatch");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
  requireRole(user, DISPATCH_CANCEL_ROLES);
  const dispatch = await getDispatchOrThrow(dispatchId);
  if (!["CREATED", "APPROVED", "LOADING"].includes(dispatch.status)) {
    throw new DispatchError(`Cannot cancel a dispatch with status ${dispatch.status}`);
  }

  const updated = await prisma.dispatch.update({
    where: { id: dispatchId },
    data: { status: "CANCELLED", cancelledByUserId: user.id, cancelledAt: new Date(), cancellationReason: reason },
  });
  await logDispatchEvent({ dispatchId, action: "CANCELLED", userId: user.id, role: user.role, reason });
  return updated;
}
