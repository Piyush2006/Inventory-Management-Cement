import { describe, it, expect } from "vitest";
import { getLocationOnHand } from "@/lib/inventory/balance";
import { getQualityBalances } from "@/lib/inventory/quality";
import { postSpareReturn, SpareReturnError } from "@/lib/inventory/spareReturn";
import { createStockRequest } from "@/lib/inventory/requests";
import { makeLocation, makeMaterial, makeUser } from "./helpers";

describe("postSpareReturn — condition maps onto the existing quality statuses, no new state system", () => {
  it("UNUSED stays Unrestricted — a plain stock-in with no QualityBalance row created", async () => {
    const location = await makeLocation();
    const spare = await makeMaterial({ category: "SPARE" });
    const user = await makeUser({ role: "STORE_OPERATOR" });

    await postSpareReturn({ materialId: spare.id, locationId: location.id, quantity: 2, condition: "UNUSED", returnedBy: "Operator", userId: user.id });

    expect(await getLocationOnHand(spare.id, location.id)).toBeCloseTo(2, 6);
    const { qcHold, blocked } = await getQualityBalances(spare.id, location.id);
    expect(qcHold).toBeCloseTo(0, 6);
    expect(blocked).toBeCloseTo(0, 6);
  });

  it("SERVICEABLE stays Unrestricted, same as UNUSED", async () => {
    const location = await makeLocation();
    const spare = await makeMaterial({ category: "SPARE" });
    const user = await makeUser({ role: "STORE_OPERATOR" });

    await postSpareReturn({ materialId: spare.id, locationId: location.id, quantity: 1, condition: "SERVICEABLE", returnedBy: "Operator", userId: user.id });

    const { qcHold, blocked } = await getQualityBalances(spare.id, location.id);
    expect(qcHold).toBeCloseTo(0, 6);
    expect(blocked).toBeCloseTo(0, 6);
  });

  it("FOR_INSPECTION posts the stock-in AND moves it to QC_HOLD", async () => {
    const location = await makeLocation();
    const spare = await makeMaterial({ category: "SPARE" });
    const user = await makeUser({ role: "STORE_OPERATOR" });

    await postSpareReturn({ materialId: spare.id, locationId: location.id, quantity: 3, condition: "FOR_INSPECTION", returnedBy: "Operator", userId: user.id });

    expect(await getLocationOnHand(spare.id, location.id)).toBeCloseTo(3, 6);
    const { qcHold, blocked } = await getQualityBalances(spare.id, location.id);
    expect(qcHold).toBeCloseTo(3, 6);
    expect(blocked).toBeCloseTo(0, 6);
  });

  it("DAMAGED posts the stock-in AND moves it to BLOCKED", async () => {
    const location = await makeLocation();
    const spare = await makeMaterial({ category: "SPARE" });
    const user = await makeUser({ role: "STORE_OPERATOR" });

    await postSpareReturn({ materialId: spare.id, locationId: location.id, quantity: 1, condition: "DAMAGED", returnedBy: "Operator", userId: user.id });

    expect(await getLocationOnHand(spare.id, location.id)).toBeCloseTo(1, 6);
    const { qcHold, blocked } = await getQualityBalances(spare.id, location.id);
    expect(qcHold).toBeCloseTo(0, 6);
    expect(blocked).toBeCloseTo(1, 6);
  });

  it("never mutates a non-spare material's stock — rejects with SpareReturnError", async () => {
    const location = await makeLocation();
    const material = await makeMaterial({ category: "RAW_MATERIAL" });
    const user = await makeUser({ role: "STORE_OPERATOR" });

    await expect(
      postSpareReturn({ materialId: material.id, locationId: location.id, quantity: 1, condition: "UNUSED", returnedBy: "Operator", userId: user.id })
    ).rejects.toThrow(SpareReturnError);
    expect(await getLocationOnHand(material.id, location.id)).toBeCloseTo(0, 6);
  });

  it("links the return to the original request via reference, distinguishable from a plain GRN receipt", async () => {
    const location = await makeLocation();
    const spare = await makeMaterial({ category: "SPARE" });
    const user = await makeUser({ role: "STORE_OPERATOR" });

    const tx = await postSpareReturn({ materialId: spare.id, locationId: location.id, quantity: 1, condition: "DAMAGED", returnedBy: "Suresh", relatedRequestNumber: "REQ-TEST-0001", remarks: "Cracked race", userId: user.id });

    expect(tx.reference).toBe("REQ-TEST-0001");
    expect(tx.transactionType).toBe("RECEIPT");
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
