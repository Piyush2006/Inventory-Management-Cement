import { describe, it, expect } from "vitest";
import { postMovement } from "@/lib/inventory/ledger";
import {
  createStockRequest,
  acceptStockRequest,
  rejectStockRequest,
  routeToSupervisor,
  assignOperator,
  startDelivery,
  markDelivered,
  confirmReceipt,
  markNotReceived,
  RequestError,
} from "@/lib/inventory/requests";
import { PermissionError } from "@/lib/auth";
import { getStockLevels } from "@/lib/inventory/balance";
import { makeLocation, makeMaterial, makeUser, getBalance } from "./helpers";
import { prisma } from "@/lib/db";

// Accept/Reject and Assign are split: Inventory Manager decides whether to accept a request,
// Store Supervisor's only job is assigning a Store/Delivery Operator once it's accepted.
async function setup(materialQty = 5000) {
  const from = await makeLocation();
  const to = await makeLocation();
  const material = await makeMaterial();
  await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: materialQty, uom: "MT", locationId: from.id });
  const requester = await makeUser({ role: "REQUESTER" });
  const manager = await makeUser({ role: "INVENTORY_MANAGER" });
  const supervisor = await makeUser({ role: "STORE_SUPERVISOR" });
  const operator = await makeUser({ role: "STORE_OPERATOR" });
  return { from, to, material, requester, manager, supervisor, operator };
}

describe("request lifecycle", () => {
  it("walks the full path: NEW_REQUEST -> ACCEPTED -> ASSIGNED -> IN_TRANSIT -> DELIVERED -> COMPLETED, same request ID throughout", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 500, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    expect(request.status).toBe("NEW_REQUEST");

    const accepted = await acceptStockRequest(request.id, manager.id);
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.id).toBe(request.id);

    const routed = await routeToSupervisor(request.id, supervisor.id, manager.id);
    expect(routed.routedToUserId).toBe(supervisor.id);

    const assigned = await assignOperator(request.id, operator.id, supervisor.id);
    expect(assigned.status).toBe("ASSIGNED");
    expect(assigned.assignedToUserId).toBe(operator.id);
    // Assignment reserves stock without moving it — On Hand unchanged, Available drops.
    const levelsAfterAssign = await getStockLevels(material.id, from.id);
    expect(levelsAfterAssign.onHand).toBeCloseTo(5000, 6);
    expect(levelsAfterAssign.reserved).toBeCloseTo(500, 6);
    expect(levelsAfterAssign.available).toBeCloseTo(4500, 6);

    const inTransit = await startDelivery(request.id, operator.id);
    expect(inTransit.status).toBe("IN_TRANSIT");
    // Starting delivery physically moves stock: source On Hand drops, destination does NOT increase yet.
    expect(await getBalance(material.id, from.id)).toBeCloseTo(4500, 6);
    expect(await getBalance(material.id, to.id)).toBeCloseTo(0, 6);
    const levelsAfterStart = await getStockLevels(material.id, from.id);
    expect(levelsAfterStart.reserved).toBeCloseTo(0, 6);

    const delivered = await markDelivered(request.id, operator.id, "Left at the dock");
    expect(delivered.status).toBe("DELIVERED");
    // Marking delivered does not move any stock — it's still sitting in the in-transit bucket.
    expect(await getBalance(material.id, to.id)).toBeCloseTo(0, 6);

    const completed = await confirmReceipt(request.id, 500, requester.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.id).toBe(request.id);
    expect(completed.completedAt).toBeTruthy();
    expect(await getBalance(material.id, to.id)).toBeCloseTo(500, 6);

    const relatedTx = await prisma.inventoryTransaction.findMany({ where: { reference: request.requestNumber } });
    expect(relatedTx.length).toBeGreaterThanOrEqual(2);
    expect(relatedTx.every((t) => t.transactionType === "TRANSFER_OUT" || t.transactionType === "TRANSFER_IN")).toBe(true);

    const events = await prisma.requestEvent.findMany({ where: { stockRequestId: request.id }, orderBy: { timestamp: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["REQUEST_CREATED", "ACCEPTED", "ROUTED", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "RECEIVED", "COMPLETED"]);
  });

  it("supports partial receipt: the supervisor re-assigns for the remaining quantity under the same Request ID", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 1000, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operator.id, supervisor.id);
    await startDelivery(request.id, operator.id);
    await markDelivered(request.id, operator.id);
    const afterFirstRound = await confirmReceipt(request.id, 600, requester.id);
    expect(afterFirstRound.status).toBe("PARTIALLY_RECEIVED");
    expect(afterFirstRound.receivedQuantity).toBeCloseTo(600, 6);

    // Second round for the remaining 400 — same request ID, cycling back through ASSIGNED/IN_TRANSIT/DELIVERED.
    await assignOperator(request.id, operator.id, supervisor.id);
    await startDelivery(request.id, operator.id);
    await markDelivered(request.id, operator.id);
    const final = await confirmReceipt(request.id, 400, requester.id);
    expect(final.status).toBe("COMPLETED");
    expect(final.receivedQuantity).toBeCloseTo(1000, 6);
    expect(final.id).toBe(request.id);

    const events = await prisma.requestEvent.findMany({ where: { stockRequestId: request.id } });
    expect(events.filter((e) => e.action === "REQUEST_CREATED")).toHaveLength(1);
  });

  it("handles a NOT_RECEIVED exception: re-assigning for redelivery posts no duplicate stock movement", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 300, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operator.id, supervisor.id);
    await startDelivery(request.id, operator.id);
    await markDelivered(request.id, operator.id);

    const notReceived = await markNotReceived(request.id, requester.id, "Material did not arrive");
    expect(notReceived.status).toBe("NOT_RECEIVED");
    expect(notReceived.notReceivedReason).toBe("Material did not arrive");

    // Re-assign for redelivery — nothing new to physically move (it's already out of source).
    const reassigned = await assignOperator(request.id, operator.id, supervisor.id);
    expect(reassigned.status).toBe("ASSIGNED");
    const balanceBeforeRedelivery = await getBalance(material.id, from.id);

    const redelivered = await startDelivery(request.id, operator.id);
    expect(redelivered.status).toBe("IN_TRANSIT");
    expect(await getBalance(material.id, from.id)).toBeCloseTo(balanceBeforeRedelivery, 6); // no double-move

    await markDelivered(request.id, operator.id);
    const completed = await confirmReceipt(request.id, 300, requester.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.id).toBe(request.id);
    expect(await getBalance(material.id, to.id)).toBeCloseTo(300, 6);
  });

  it("rejection requires a reason and only works from NEW_REQUEST", async () => {
    const { from, to, material, requester, manager } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 100, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });

    await expect(rejectStockRequest(request.id, manager.id, "")).rejects.toThrow(RequestError);
    const rejected = await rejectStockRequest(request.id, manager.id, "Insufficient stock");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Insufficient stock");

    await expect(rejectStockRequest(request.id, manager.id, "again")).rejects.toThrow(RequestError);
  });

  it("only an Inventory Manager (or Admin) can accept — the requester cannot accept their own request", async () => {
    const { from, to, material, requester } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 100, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });

    await expect(acceptStockRequest(request.id, requester.id)).rejects.toThrow(PermissionError);
  });

  it("Store Supervisor can no longer accept or reject — only assign — while Inventory Manager can do both", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 150, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });

    await expect(acceptStockRequest(request.id, supervisor.id)).rejects.toThrow(PermissionError);
    await expect(rejectStockRequest(request.id, supervisor.id, "not my call anymore")).rejects.toThrow(PermissionError);

    const accepted = await acceptStockRequest(request.id, manager.id);
    expect(accepted.status).toBe("ACCEPTED");
    // Not yet routed — Supervisor can't jump straight to assigning.
    await expect(assignOperator(request.id, operator.id, supervisor.id)).rejects.toThrow(RequestError);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    // Supervisor's one job, now that it's routed to them: assign the operator.
    const assigned = await assignOperator(request.id, operator.id, supervisor.id);
    expect(assigned.status).toBe("ASSIGNED");
    expect(assigned.assignedToUserId).toBe(operator.id);
  });

  it("Inventory Manager routes to a Supervisor but can no longer assign an operator directly — that's the routed Supervisor's job now", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 150, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });

    const accepted = await acceptStockRequest(request.id, manager.id);
    expect(accepted.status).toBe("ACCEPTED");
    await expect(assignOperator(request.id, operator.id, manager.id)).rejects.toThrow(PermissionError);

    const routed = await routeToSupervisor(request.id, supervisor.id, manager.id);
    expect(routed.routedToUserId).toBe(supervisor.id);
    expect(routed.routedByUserId).toBe(manager.id);
    expect(routed.status).toBe("ACCEPTED"); // routing doesn't change status

    // A different Supervisor — even though Supervisors in general are in ASSIGN_ROLES — can't
    // assign an operator on a request routed to someone else.
    const otherSupervisor = await makeUser({ role: "STORE_SUPERVISOR" });
    await expect(assignOperator(request.id, operator.id, otherSupervisor.id)).rejects.toThrow(PermissionError);

    const assigned = await assignOperator(request.id, operator.id, supervisor.id);
    expect(assigned.status).toBe("ASSIGNED");
    expect(assigned.assignedToUserId).toBe(operator.id);
  });

  it("only the Inventory Manager (or Admin) can route a request, and only to a Store Supervisor", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 120, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, manager.id);

    await expect(routeToSupervisor(request.id, supervisor.id, supervisor.id)).rejects.toThrow(PermissionError);
    await expect(routeToSupervisor(request.id, operator.id, manager.id)).rejects.toThrow(PermissionError); // target must be a Supervisor

    const routed = await routeToSupervisor(request.id, supervisor.id, manager.id);
    expect(routed.routedToUserId).toBe(supervisor.id);

    // Re-routing to a different Supervisor is allowed and overwrites who can assign.
    const otherSupervisor = await makeUser({ role: "STORE_SUPERVISOR" });
    const rerouted = await routeToSupervisor(request.id, otherSupervisor.id, manager.id);
    expect(rerouted.routedToUserId).toBe(otherSupervisor.id);
    await expect(assignOperator(request.id, operator.id, supervisor.id)).rejects.toThrow(PermissionError);
    const assigned = await assignOperator(request.id, operator.id, otherSupervisor.id);
    expect(assigned.status).toBe("ASSIGNED");
  });

  it("only the specific assigned operator can start delivery or mark delivered — not any Store Operator", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup();
    const otherOperator = await makeUser({ role: "STORE_OPERATOR" });
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 100, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operator.id, supervisor.id);

    await expect(startDelivery(request.id, otherOperator.id)).rejects.toThrow(PermissionError);
    const inTransit = await startDelivery(request.id, operator.id);
    expect(inTransit.status).toBe("IN_TRANSIT");
    await expect(markDelivered(request.id, otherOperator.id)).rejects.toThrow(PermissionError);
  });

  it("only the original requester can confirm receipt or report not received", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup();
    const otherRequester = await makeUser({ role: "REQUESTER" });
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 100, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operator.id, supervisor.id);
    await startDelivery(request.id, operator.id);
    await markDelivered(request.id, operator.id);

    await expect(confirmReceipt(request.id, 100, otherRequester.id)).rejects.toThrow(PermissionError);
    await expect(markNotReceived(request.id, otherRequester.id, "wrong person")).rejects.toThrow(PermissionError);
    const received = await confirmReceipt(request.id, 100, requester.id);
    expect(received.status).toBe("COMPLETED");
  });

  it("stock-availability validation is disabled for now — assigning and starting delivery succeed even past what's on hand", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup(1000);
    const requestA = await createStockRequest({ materialId: material.id, quantityRequested: 800, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(requestA.id, manager.id);
    await routeToSupervisor(requestA.id, supervisor.id, manager.id);
    await assignOperator(requestA.id, operator.id, supervisor.id); // reserves 800 of 1000 on hand — 200 "available"

    // A second request for 500 more (only 200 actually available) is still allowed to be
    // assigned and delivered — no error, by design, until this is turned back on.
    const requestB = await createStockRequest({ materialId: material.id, quantityRequested: 500, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(requestB.id, manager.id);
    await routeToSupervisor(requestB.id, supervisor.id, manager.id);
    const assigned = await assignOperator(requestB.id, operator.id, supervisor.id);
    expect(assigned.status).toBe("ASSIGNED");
    const inTransit = await startDelivery(requestB.id, operator.id);
    expect(inTransit.status).toBe("IN_TRANSIT");
  });

  it("confirming receipt of more than was delivered still succeeds — no validation, ever, and it auto-completes the request", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 500, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operator.id, supervisor.id);
    await startDelivery(request.id, operator.id);
    await markDelivered(request.id, operator.id);

    const received = await confirmReceipt(request.id, 600, requester.id);
    expect(received.status).toBe("COMPLETED"); // 600 received >= 500 requested
    expect(received.receivedQuantity).toBeCloseTo(600, 6);
  });

  it("can only assign a user with the Store/Delivery Operator role", async () => {
    const { from, to, material, requester, manager, supervisor } = await setup();
    const notAnOperator = await makeUser({ role: "REQUESTER" });
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 100, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);

    await expect(assignOperator(request.id, notAnOperator.id, supervisor.id)).rejects.toThrow(PermissionError);
  });

  it("Admin has full access — can accept, assign, start delivery, mark delivered, and confirm receipt on any request, bypassing ownership checks", async () => {
    const { from, to, material, requester, operator } = await setup();
    const admin = await makeUser({ role: "ADMIN" });
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 250, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });

    const accepted = await acceptStockRequest(request.id, admin.id); // Admin acting as the Inventory Manager
    expect(accepted.status).toBe("ACCEPTED");
    const assigned = await assignOperator(request.id, operator.id, admin.id);
    expect(assigned.status).toBe("ASSIGNED");

    // Admin starts/marks delivery even though the request is assigned to `operator`, not Admin.
    const inTransit = await startDelivery(request.id, admin.id);
    expect(inTransit.status).toBe("IN_TRANSIT");
    const delivered = await markDelivered(request.id, admin.id);
    expect(delivered.status).toBe("DELIVERED");

    // Admin confirms receipt even though the original requester is `requester`, not Admin.
    const completed = await confirmReceipt(request.id, 250, admin.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.id).toBe(request.id);
  });

  it("Admin can report not received on any request, bypassing the original-requester check", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup();
    const admin = await makeUser({ role: "ADMIN" });
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 100, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operator.id, supervisor.id);
    await startDelivery(request.id, operator.id);
    await markDelivered(request.id, operator.id);

    const notReceived = await markNotReceived(request.id, admin.id, "Admin investigating a discrepancy");
    expect(notReceived.status).toBe("NOT_RECEIVED");
  });
});
