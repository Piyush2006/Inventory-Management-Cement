import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { getLocationOnHand } from "@/lib/inventory/balance";
import { getQualityBalances } from "@/lib/inventory/quality";
import { postSpareReturn, SpareReturnError } from "@/lib/inventory/spareReturn";
import { createStockRequest } from "@/lib/inventory/requests";
import { makeLocation, makeMaterial, makeUser, makeSpareIssueRequest } from "./helpers";

async function setupSpareIssue(deliveredQuantity = 2) {
  const location = await makeLocation();
  const spare = await makeMaterial({ category: "SPARE" });
  const requester = await makeUser({ role: "REQUESTER" });
  const operator = await makeUser({ role: "STORE_OPERATOR" });
  const request = await makeSpareIssueRequest({ materialId: spare.id, fromLocationId: location.id, requestedByUserId: requester.id, deliveredQuantity });
  return { location, spare, operator, request };
}

describe("postSpareReturn — condition maps onto the existing quality statuses, no new state system", () => {
  it("UNUSED stays Unrestricted — a plain stock-in with no QualityBalance row created", async () => {
    const { location, spare, operator, request } = await setupSpareIssue(2);

    await postSpareReturn({ requestId: request.id, materialId: spare.id, locationId: location.id, quantity: 2, condition: "UNUSED", returnedBy: "Operator", userId: operator.id });

    expect(await getLocationOnHand(spare.id, location.id)).toBeCloseTo(2, 6);
    const { qcHold, blocked } = await getQualityBalances(spare.id, location.id);
    expect(qcHold).toBeCloseTo(0, 6);
    expect(blocked).toBeCloseTo(0, 6);
  });

  it("SERVICEABLE stays Unrestricted, same as UNUSED", async () => {
    const { location, spare, operator, request } = await setupSpareIssue(1);

    await postSpareReturn({ requestId: request.id, materialId: spare.id, locationId: location.id, quantity: 1, condition: "SERVICEABLE", returnedBy: "Operator", userId: operator.id });

    const { qcHold, blocked } = await getQualityBalances(spare.id, location.id);
    expect(qcHold).toBeCloseTo(0, 6);
    expect(blocked).toBeCloseTo(0, 6);
  });

  it("FOR_INSPECTION posts the stock-in AND moves it to QC_HOLD", async () => {
    const { location, spare, operator, request } = await setupSpareIssue(3);

    await postSpareReturn({ requestId: request.id, materialId: spare.id, locationId: location.id, quantity: 3, condition: "FOR_INSPECTION", returnedBy: "Operator", userId: operator.id });

    expect(await getLocationOnHand(spare.id, location.id)).toBeCloseTo(3, 6);
    const { qcHold, blocked } = await getQualityBalances(spare.id, location.id);
    expect(qcHold).toBeCloseTo(3, 6);
    expect(blocked).toBeCloseTo(0, 6);
  });

  it("DAMAGED posts the stock-in AND moves it to BLOCKED", async () => {
    const { location, spare, operator, request } = await setupSpareIssue(1);

    await postSpareReturn({ requestId: request.id, materialId: spare.id, locationId: location.id, quantity: 1, condition: "DAMAGED", returnedBy: "Operator", userId: operator.id });

    expect(await getLocationOnHand(spare.id, location.id)).toBeCloseTo(1, 6);
    const { qcHold, blocked } = await getQualityBalances(spare.id, location.id);
    expect(qcHold).toBeCloseTo(0, 6);
    expect(blocked).toBeCloseTo(1, 6);
  });

  it("never mutates a non-spare material's stock — rejects with SpareReturnError", async () => {
    const location = await makeLocation();
    const material = await makeMaterial({ category: "RAW_MATERIAL" });
    const requester = await makeUser({ role: "REQUESTER" });
    const operator = await makeUser({ role: "STORE_OPERATOR" });
    const request = await makeSpareIssueRequest({ materialId: material.id, fromLocationId: location.id, requestedByUserId: requester.id });

    await expect(
      postSpareReturn({ requestId: request.id, materialId: material.id, locationId: location.id, quantity: 1, condition: "UNUSED", returnedBy: "Operator", userId: operator.id })
    ).rejects.toThrow(SpareReturnError);
    expect(await getLocationOnHand(material.id, location.id)).toBeCloseTo(0, 6);
  });

  it("rejects a request that isn't a spare ISSUE (e.g. a TRANSFER-purpose request)", async () => {
    const location = await makeLocation();
    const destination = await makeLocation();
    const spare = await makeMaterial({ category: "SPARE" });
    const requester = await makeUser({ role: "REQUESTER" });
    const operator = await makeUser({ role: "STORE_OPERATOR" });
    const transferRequest = await createStockRequest({
      materialId: spare.id, quantityRequested: 1, requiredByDate: new Date(), fromLocationId: location.id, toLocationId: destination.id,
      requestedByUserId: requester.id, requestType: "SPARE",
    });

    await expect(
      postSpareReturn({ requestId: transferRequest.id, materialId: spare.id, locationId: location.id, quantity: 1, condition: "UNUSED", returnedBy: "Operator", userId: operator.id })
    ).rejects.toThrow(SpareReturnError);
  });

  it("rejects a return quantity exceeding what's still outstanding on the linked issue", async () => {
    const { location, spare, operator, request } = await setupSpareIssue(2);

    await expect(
      postSpareReturn({ requestId: request.id, materialId: spare.id, locationId: location.id, quantity: 3, condition: "UNUSED", returnedBy: "Operator", userId: operator.id })
    ).rejects.toThrow(SpareReturnError);
    expect(await getLocationOnHand(spare.id, location.id)).toBeCloseTo(0, 6);
  });

  it("a second return is capped by what the first already used up", async () => {
    const { location, spare, operator, request } = await setupSpareIssue(2);

    await postSpareReturn({ requestId: request.id, materialId: spare.id, locationId: location.id, quantity: 1.5, condition: "UNUSED", returnedBy: "Operator", userId: operator.id });
    await expect(
      postSpareReturn({ requestId: request.id, materialId: spare.id, locationId: location.id, quantity: 1, condition: "UNUSED", returnedBy: "Operator", userId: operator.id })
    ).rejects.toThrow(SpareReturnError);
  });

  it("persists a SpareReturn record linked to the original issue and the posted transaction, distinguishable from a plain GRN receipt", async () => {
    const { location, spare, operator, request } = await setupSpareIssue(1);

    const spareReturn = await postSpareReturn({
      requestId: request.id, materialId: spare.id, locationId: location.id, quantity: 1, condition: "DAMAGED",
      returnedBy: "Suresh", remarks: "Cracked race", userId: operator.id,
    });

    expect(spareReturn.requestId).toBe(request.id);
    expect(spareReturn.originalIssueReference).toBe(request.requestNumber);
    expect(spareReturn.returnReference).toMatch(/^RET-/);
    expect(spareReturn.condition).toBe("DAMAGED");

    const tx = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: spareReturn.inventoryTransactionId } });
    expect(tx.transactionType).toBe("RECEIPT");
    expect(tx.reference).toBe(spareReturn.returnReference);
    expect(tx.reason).toContain("Returned by Suresh");
    expect(tx.reason).toContain("DAMAGED");
  });
});

describe("createStockRequest — requestType/equipmentRef pass-through (spare requests reuse the exact existing lifecycle)", () => {
  it("defaults to requestType MATERIAL with no equipmentRef when omitted, unaffected by this feature", async () => {
    const from = await makeLocation();
    const to = await makeLocation();
    const material = await makeMaterial();
    const requester = await makeUser({ role: "REQUESTER" });

    const request = await createStockRequest({ materialId: material.id, quantityRequested: 10, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });

    expect(request.requestType).toBe("MATERIAL");
    expect(request.equipmentRef).toBeNull();
  });

  it("stores requestType SPARE and equipmentRef when a spare request is raised", async () => {
    const from = await makeLocation();
    const to = await makeLocation();
    const spare = await makeMaterial({ category: "SPARE" });
    const requester = await makeUser({ role: "REQUESTER" });

    const request = await createStockRequest({
      materialId: spare.id, quantityRequested: 2, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id,
      requestedByUserId: requester.id, requestType: "SPARE", equipmentRef: "Conveyor C-102",
    });

    expect(request.requestType).toBe("SPARE");
    expect(request.equipmentRef).toBe("Conveyor C-102");
  });
});
