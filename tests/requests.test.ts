import { describe, it, expect } from "vitest";
import { postMovement } from "@/lib/inventory/ledger";
import {
  createStockRequest,
  acceptStockRequest,
  rejectStockRequest,
  cancelStockRequest,
  allocateStock,
  issueStock,
  confirmReceipt,
  RequestError,
} from "@/lib/inventory/requests";
import { PermissionError } from "@/lib/auth";
import { getStockLevels } from "@/lib/inventory/balance";
import { makeLocation, makeMaterial, makeUser, getBalance } from "./helpers";
import { prisma } from "@/lib/db";

async function setup(materialQty = 5000) {
  const from = await makeLocation();
  const to = await makeLocation();
  const material = await makeMaterial();
  await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: materialQty, uom: "MT", locationId: from.id });
  const requester = await makeUser({ role: "REQUESTER" });
  const store = await makeUser({ role: "STORE_OPERATOR" });
  return { from, to, material, requester, store };
}

describe("stock request lifecycle", () => {
  it("walks the full path: PENDING -> ACCEPTED -> ALLOCATED -> IN_TRANSIT -> COMPLETED, same request ID throughout", async () => {
    const { from, to, material, requester, store } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 500, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    expect(request.status).toBe("PENDING");

    const accepted = await acceptStockRequest(request.id, store.id);
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.id).toBe(request.id);

    const allocated = await allocateStock(request.id, 500, store.id);
    expect(allocated.status).toBe("ALLOCATED");
    expect(allocated.id).toBe(request.id);
    // Allocation reserves stock without moving it — On Hand at source is unchanged, but Available drops.
    const levelsAfterAllocate = await getStockLevels(material.id, from.id);
    expect(levelsAfterAllocate.onHand).toBeCloseTo(5000, 6);
    expect(levelsAfterAllocate.reserved).toBeCloseTo(500, 6);
    expect(levelsAfterAllocate.available).toBeCloseTo(4500, 6);

    const issued = await issueStock(request.id, 500, store.id);
    expect(issued.status).toBe("IN_TRANSIT");
    expect(issued.id).toBe(request.id);
    // Issuing physically moves stock: source On Hand drops, destination On Hand does NOT increase yet.
    expect(await getBalance(material.id, from.id)).toBeCloseTo(4500, 6);
    expect(await getBalance(material.id, to.id)).toBeCloseTo(0, 6);
    // Reservation is released once issued.
    const levelsAfterIssue = await getStockLevels(material.id, from.id);
    expect(levelsAfterIssue.reserved).toBeCloseTo(0, 6);

    const received = await confirmReceipt(request.id, 500, requester.id);
    expect(received.status).toBe("COMPLETED");
    expect(received.id).toBe(request.id);
    expect(received.completedAt).toBeTruthy();
    expect(await getBalance(material.id, to.id)).toBeCloseTo(500, 6);

    // Every stock movement for this request references the same request number.
    const relatedTx = await prisma.inventoryTransaction.findMany({ where: { reference: request.requestNumber } });
    expect(relatedTx.length).toBeGreaterThanOrEqual(2); // TRANSFER_OUT + TRANSFER_IN
    expect(relatedTx.every((t) => t.transactionType === "TRANSFER_OUT" || t.transactionType === "TRANSFER_IN")).toBe(true);

    // Full timeline persisted, not hard-coded.
    const events = await prisma.requestEvent.findMany({ where: { stockRequestId: request.id }, orderBy: { timestamp: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["REQUEST_RAISED", "ACCEPTED", "ALLOCATED", "ISSUED", "RECEIVED", "COMPLETED"]);
  });

  it("supports partial fulfilment across multiple allocate/issue/receive rounds without creating a new request", async () => {
    const { from, to, material, requester, store } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 1000, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, store.id);

    await allocateStock(request.id, 600, store.id);
    await issueStock(request.id, 600, store.id);
    const afterFirstRound = await confirmReceipt(request.id, 600, requester.id);
    expect(afterFirstRound.status).toBe("PARTIALLY_RECEIVED");
    expect(afterFirstRound.receivedQuantity).toBeCloseTo(600, 6);

    // Second round for the remaining 400 — same request ID, cycling back through ALLOCATED/IN_TRANSIT.
    await allocateStock(request.id, 400, store.id);
    await issueStock(request.id, 400, store.id);
    const final = await confirmReceipt(request.id, 400, requester.id);
    expect(final.status).toBe("COMPLETED");
    expect(final.receivedQuantity).toBeCloseTo(1000, 6);
    expect(final.id).toBe(request.id);

    const events = await prisma.requestEvent.findMany({ where: { stockRequestId: request.id } });
    // No REQUEST_RAISED for a second request — everything is on the original request's timeline.
    expect(events.filter((e) => e.action === "REQUEST_RAISED")).toHaveLength(1);
  });

  it("rejection requires a reason and only works from PENDING", async () => {
    const { from, to, material, requester, store } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 100, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });

    await expect(rejectStockRequest(request.id, store.id, "")).rejects.toThrow(RequestError);
    const rejected = await rejectStockRequest(request.id, store.id, "Insufficient stock");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Insufficient stock");

    await expect(rejectStockRequest(request.id, store.id, "again")).rejects.toThrow(RequestError);
  });

  it("only a REQUESTER/STORE_OPERATOR/MANAGER role can accept — enforced server-side, not just hidden buttons", async () => {
    const { from, to, material, requester } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 100, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });

    // The requester themselves cannot accept their own request.
    await expect(acceptStockRequest(request.id, requester.id)).rejects.toThrow(PermissionError);
  });

  it("only the requester who raised a request can cancel it, and only while PENDING", async () => {
    const { from, to, material, requester, store } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 100, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });

    await expect(cancelStockRequest(request.id, store.id)).rejects.toThrow(PermissionError);
    const cancelled = await cancelStockRequest(request.id, requester.id);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("only the requester who raised it can confirm receipt", async () => {
    const { from, to, material, requester, store } = await setup();
    const otherRequester = await makeUser({ role: "REQUESTER" });
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 100, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, store.id);
    await allocateStock(request.id, 100, store.id);
    await issueStock(request.id, 100, store.id);

    await expect(confirmReceipt(request.id, 100, otherRequester.id)).rejects.toThrow(PermissionError);
    const received = await confirmReceipt(request.id, 100, requester.id);
    expect(received.status).toBe("COMPLETED");
  });

  it("rejects allocating more than is available (On Hand minus already-Reserved)", async () => {
    const { from, to, material, requester, store } = await setup(1000);
    const requestA = await createStockRequest({ materialId: material.id, quantityRequested: 800, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(requestA.id, store.id);
    await allocateStock(requestA.id, 800, store.id); // reserves 800 of 1000 on hand — 200 available

    const requestB = await createStockRequest({ materialId: material.id, quantityRequested: 500, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(requestB.id, store.id);
    await expect(allocateStock(requestB.id, 500, store.id)).rejects.toThrow(RequestError);
  });

  it("rejects issuing more than is currently allocated-and-unissued, and receiving more than is currently in transit", async () => {
    const { from, to, material, requester, store } = await setup();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 500, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, store.id);
    await allocateStock(request.id, 300, store.id);

    await expect(issueStock(request.id, 400, store.id)).rejects.toThrow(RequestError);
    await issueStock(request.id, 300, store.id);
    await expect(confirmReceipt(request.id, 400, requester.id)).rejects.toThrow(RequestError);
  });
});
