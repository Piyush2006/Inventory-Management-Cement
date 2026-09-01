import { describe, it, expect } from "vitest";
import { postMovement, postAdjustment, postTransfer, InventoryError } from "@/lib/inventory/ledger";
import { getBalance } from "./helpers";
import { makeLocation, makeMaterial } from "./helpers";

describe("inventory balance", () => {
  it("accumulates from RECEIPT and CONSUMPTION transactions", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();

    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 1000, uom: "MT", locationId: location.id });
    await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 400, uom: "MT", locationId: location.id });

    expect(await getBalance(material.id, location.id)).toBeCloseTo(600, 6);
  });

  it("a movement that would take a balance negative still posts — no validation, ever", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();

    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 100, uom: "MT", locationId: location.id });
    await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 150, uom: "MT", locationId: location.id });
    expect(await getBalance(material.id, location.id)).toBeCloseTo(-50, 6); // negative, posted anyway
  });

  it("a receipt exceeding a location's capacity still posts — capacity is informational only, never a gate on adding stock", async () => {
    const location = await makeLocation({ capacity: 500 });
    const material = await makeMaterial();

    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 400, uom: "MT", locationId: location.id });
    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 200, uom: "MT", locationId: location.id });
    expect(await getBalance(material.id, location.id)).toBeCloseTo(600, 6); // over the 500 capacity, posted anyway
  });

  it("a transfer into a location exceeding its capacity still posts", async () => {
    const source = await makeLocation();
    const destination = await makeLocation({ capacity: 100 });
    const material = await makeMaterial();

    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 1000, uom: "MT", locationId: source.id });
    await postTransfer({ materialId: material.id, quantity: 300, uom: "MT", sourceLocationId: source.id, destinationLocationId: destination.id });
    expect(await getBalance(material.id, destination.id)).toBeCloseTo(300, 6); // over the 100 capacity, posted anyway
  });

  it("allows a signed adjustment with a reason, bypassing the negative/capacity checks", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();

    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 500, uom: "MT", locationId: location.id });
    await postAdjustment({ materialId: material.id, locationId: location.id, quantity: -20, uom: "MT", reason: "Moisture loss" });

    expect(await getBalance(material.id, location.id)).toBeCloseTo(480, 6);
  });

  it("rejects an adjustment without a reason", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();
    await expect(postAdjustment({ materialId: material.id, locationId: location.id, quantity: 10, uom: "MT", reason: "" })).rejects.toThrow();
  });

  it("a transfer from a location without enough stock still posts — no validation, ever", async () => {
    const source = await makeLocation();
    const destination = await makeLocation();
    const material = await makeMaterial();

    await postTransfer({ materialId: material.id, quantity: 300, uom: "MT", sourceLocationId: source.id, destinationLocationId: destination.id });
    expect(await getBalance(material.id, source.id)).toBeCloseTo(-300, 6); // negative, posted anyway
    expect(await getBalance(material.id, destination.id)).toBeCloseTo(300, 6);
  });

  it("transfer moves stock atomically between two locations", async () => {
    const source = await makeLocation();
    const destination = await makeLocation();
    const material = await makeMaterial();

    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 1000, uom: "MT", locationId: source.id });
    await postTransfer({ materialId: material.id, quantity: 300, uom: "MT", sourceLocationId: source.id, destinationLocationId: destination.id });

    expect(await getBalance(material.id, source.id)).toBeCloseTo(700, 6);
    expect(await getBalance(material.id, destination.id)).toBeCloseTo(300, 6);
  });

  it("rejects a transfer to the same location", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();
    await expect(
      postTransfer({ materialId: material.id, quantity: 10, uom: "MT", sourceLocationId: location.id, destinationLocationId: location.id })
    ).rejects.toThrow(InventoryError);
  });
});
