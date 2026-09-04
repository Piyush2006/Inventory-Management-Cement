import { describe, it, expect } from "vitest";
import { postMovement } from "@/lib/inventory/ledger";
import { createStockRequest, acceptStockRequest, routeToSupervisor, assignOperator, startDelivery, markDelivered, confirmReceipt, RequestError } from "@/lib/inventory/requests";
import { prisma } from "@/lib/db";
import { IN_TRANSIT_LOCATION_TYPE } from "@/lib/domain/enums";
import { makeLocation, makeMaterial, makeUser, getBalance } from "./helpers";

async function setup(materialQty = 100) {
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

async function inTransitBalance(materialId: string) {
  const inTransit = await prisma.location.findFirst({ where: { type: IN_TRANSIT_LOCATION_TYPE } });
  if (!inTransit) return 0;
  return getBalance(materialId, inTransit.id);
}

describe("Request Purpose — Issue (no destination location, existing Consume ledger mechanism)", () => {
  it("createStockRequest requires issuedTo and no toLocationId for an Issue request", async () => {
    const { from, material, requester } = await setup();
    await expect(
      createStockRequest({ materialId: material.id, quantityRequested: 10, requiredByDate: new Date(), fromLocationId: from.id, requestedByUserId: requester.id, purpose: "ISSUE" })
    ).rejects.toThrow(RequestError);

    const request = await createStockRequest({ materialId: material.id, quantityRequested: 10, requiredByDate: new Date(), fromLocationId: from.id, requestedByUserId: requester.id, purpose: "ISSUE", issuedTo: "Maintenance" });
    expect(request.purpose).toBe("ISSUE");
    expect(request.issuedTo).toBe("Maintenance");
    expect(request.toLocationId).toBeNull();
  });

  it("createStockRequest still requires toLocationId for a Transfer request (default, unchanged)", async () => {
    const { from, material, requester } = await setup();
    await expect(
      createStockRequest({ materialId: material.id, quantityRequested: 10, requiredByDate: new Date(), fromLocationId: from.id, requestedByUserId: requester.id })
    ).rejects.toThrow(RequestError);
  });

  it("startDelivery posts a CONSUMPTION (not TRANSFER_OUT) and decreases source on-hand with no in-transit residue", async () => {
    const { from, material, requester, manager, supervisor, operator } = await setup(100);
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 20, requiredByDate: new Date(), fromLocationId: from.id, requestedByUserId: requester.id, purpose: "ISSUE", issuedTo: "Maintenance" });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operator.id, supervisor.id);
    await startDelivery(request.id, operator.id);

    expect(await getBalance(material.id, from.id)).toBeCloseTo(80, 6); // 100 - 20, straight CONSUMPTION
    expect(await inTransitBalance(material.id)).toBeCloseTo(0, 6); // never touched — Issue has no in-transit hop

    const consumptionTx = await prisma.inventoryTransaction.findFirst({ where: { materialId: material.id, transactionType: "CONSUMPTION", reference: request.requestNumber } });
    expect(consumptionTx).not.toBeNull();
    expect(consumptionTx?.processName).toBe("Maintenance");
    const transferOutTx = await prisma.inventoryTransaction.findFirst({ where: { materialId: material.id, transactionType: "TRANSFER_OUT", reference: request.requestNumber } });
    expect(transferOutTx).toBeNull();
  });

  it("confirmReceipt posts no further ledger row for an Issue request and still completes it", async () => {
    const { from, material, requester, manager, supervisor, operator } = await setup(100);
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 20, requiredByDate: new Date(), fromLocationId: from.id, requestedByUserId: requester.id, purpose: "ISSUE", issuedTo: "Maintenance" });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operator.id, supervisor.id);
    await startDelivery(request.id, operator.id);
    await markDelivered(request.id, operator.id);
    const balanceAfterIssue = await getBalance(material.id, from.id);

    const txCountBefore = await prisma.inventoryTransaction.count({ where: { materialId: material.id, reference: request.requestNumber } });
    const updated = await confirmReceipt(request.id, 20, requester.id);
    const txCountAfter = await prisma.inventoryTransaction.count({ where: { materialId: material.id, reference: request.requestNumber } });

    expect(updated.status).toBe("COMPLETED");
    expect(updated.receivedQuantity).toBeCloseTo(20, 6);
    expect(txCountAfter).toBe(txCountBefore); // no TRANSFER_IN or any other ledger row posted
    expect(await getBalance(material.id, from.id)).toBeCloseTo(balanceAfterIssue, 6); // unchanged by confirm
  });
});

describe("Request Purpose — Transfer (regression guard: byte-identical to pre-Purpose behavior)", () => {
  it("still moves stock through the in-transit bucket via TRANSFER_OUT/TRANSFER_IN, destination increases", async () => {
    const { from, to, material, requester, manager, supervisor, operator } = await setup(100);
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 20, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    expect(request.purpose).toBe("TRANSFER");
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operator.id, supervisor.id);
    await startDelivery(request.id, operator.id);

    expect(await getBalance(material.id, from.id)).toBeCloseTo(80, 6);
    expect(await inTransitBalance(material.id)).toBeCloseTo(20, 6);

    await markDelivered(request.id, operator.id);
    await confirmReceipt(request.id, 20, requester.id);
    expect(await getBalance(material.id, to.id)).toBeCloseTo(20, 6);
    expect(await inTransitBalance(material.id)).toBeCloseTo(0, 6);
  });
});
