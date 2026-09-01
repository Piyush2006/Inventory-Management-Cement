import { describe, it, expect } from "vitest";
import { postMovement, postPacking, deriveBagCount } from "@/lib/inventory/ledger";
import { getBalance } from "./helpers";
import { makeLocation, makeMaterial } from "./helpers";

describe("packing: bulk -> bagged conversion", () => {
  it("preserves total tonnage — bulk consumed equals bagged produced at the destination", async () => {
    const bulkLoc = await makeLocation({ name: "Cement Silo" });
    const bagLoc = await makeLocation({ name: "Bag Store" });
    const baggedLoc = await makeLocation({ name: "Bagged Warehouse" });

    const cement = await makeMaterial({ category: "FINISHED_GOODS", bagWeightKg: 20 });
    const bag = await makeMaterial({ category: "PACKING", uom: "Nos" });

    await postMovement({ materialId: cement.id, transactionType: "RECEIPT", quantity: 1000, uom: "MT", locationId: bulkLoc.id });
    await postMovement({ materialId: bag.id, transactionType: "RECEIPT", quantity: 100000, uom: "Nos", locationId: bagLoc.id });

    const { bagsNeeded } = await postPacking({
      bulkMaterialId: cement.id, bulkLocationId: bulkLoc.id, bulkQuantity: 200,
      bagMaterialId: bag.id, bagLocationId: bagLoc.id,
      baggedMaterialId: cement.id, baggedLocationId: baggedLoc.id,
    });

    expect(bagsNeeded).toBe(10000); // 200 MT at 20kg/bag
    expect(await getBalance(cement.id, bulkLoc.id)).toBeCloseTo(800, 6);
    expect(await getBalance(bag.id, bagLoc.id)).toBeCloseTo(90000, 6);
    expect(await getBalance(cement.id, baggedLoc.id)).toBeCloseTo(200, 6);
  });

  it("derives bag count from tonnage rather than storing it, so they can never drift apart", () => {
    expect(deriveBagCount(200, 20)).toBe(10000);
    expect(deriveBagCount(0, 20)).toBe(0);
    expect(deriveBagCount(200, null)).toBeNull();
  });
});
