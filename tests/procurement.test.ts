import { describe, it, expect } from "vitest";
import {
  resolveSupplier,
  createPurchaseReference,
  createMaterialReceipt,
  createAndPostMaterialReceipt,
  postMaterialReceipt,
  cancelMaterialReceipt,
  ProcurementError,
} from "@/lib/inventory/procurement";
import { getBalance } from "./helpers";
import { makeLocation, makeMaterial } from "./helpers";
import { prisma } from "@/lib/db";

async function setup() {
  const location = await makeLocation();
  const material = await makeMaterial();
  const supplier = await resolveSupplier({ name: "ABC Minerals" });
  return { location, material, supplier };
}

describe("material receipt / GRN", () => {
  it("increases inventory by accepted quantity only — never ordered or received", async () => {
    const { location, material, supplier } = await setup();

    const receipt = await createAndPostMaterialReceipt({
      supplierId: supplier.id,
      materialId: material.id,
      receiptDate: new Date(),
      receivedQuantity: 2000,
      acceptedQuantity: 1980,
      destinationLocationId: location.id,
      invoiceNumber: "INV-4587",
    });

    expect(receipt.status).toBe("POSTED");
    expect(receipt.rejectedQuantity).toBeCloseTo(20, 6);
    expect(await getBalance(material.id, location.id)).toBeCloseTo(1980, 6); // not 2000, not any "ordered" quantity

    const tx = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: receipt.inventoryTransactionId! } });
    expect(tx.transactionType).toBe("RECEIPT");
    expect(tx.quantity).toBeCloseTo(1980, 6);
    expect(tx.reference).toBe(receipt.grnNumber);
  });

  it("derives rejected quantity automatically and validates accepted + rejected = received", async () => {
    const { location, material, supplier } = await setup();
    await expect(
      createMaterialReceipt({ supplierId: supplier.id, materialId: material.id, receiptDate: new Date(), receivedQuantity: 100, acceptedQuantity: 150, destinationLocationId: location.id })
    ).rejects.toThrow(ProcurementError);
  });

  it("a DRAFT receipt never changes stock; posting it does, exactly once", async () => {
    const { location, material, supplier } = await setup();
    const draft = await createMaterialReceipt({ supplierId: supplier.id, materialId: material.id, receiptDate: new Date(), receivedQuantity: 500, acceptedQuantity: 500, destinationLocationId: location.id });

    expect(draft.status).toBe("DRAFT");
    expect(await getBalance(material.id, location.id)).toBeCloseTo(0, 6);

    const posted = await postMaterialReceipt(draft.id);
    expect(posted.status).toBe("POSTED");
    expect(await getBalance(material.id, location.id)).toBeCloseTo(500, 6);

    await expect(postMaterialReceipt(draft.id)).rejects.toThrow(ProcurementError); // can't post twice
    expect(await getBalance(material.id, location.id)).toBeCloseTo(500, 6); // still exactly once
  });

  it("supports partial receipts against a PO, rolling PO status forward by cumulative accepted quantity", async () => {
    const { location, material, supplier } = await setup();
    const po = await createPurchaseReference({ supplierId: supplier.id, materialId: material.id, orderedQuantity: 2500 });
    expect(po.status).toBe("EXPECTED");

    await createAndPostMaterialReceipt({ supplierId: supplier.id, purchaseReferenceId: po.id, materialId: material.id, receiptDate: new Date(), receivedQuantity: 1500, acceptedQuantity: 1500, destinationLocationId: location.id });
    let updated = await prisma.purchaseReference.findUniqueOrThrow({ where: { id: po.id } });
    expect(updated.status).toBe("PARTIALLY_RECEIVED");

    await createAndPostMaterialReceipt({ supplierId: supplier.id, purchaseReferenceId: po.id, materialId: material.id, receiptDate: new Date(), receivedQuantity: 1000, acceptedQuantity: 1000, destinationLocationId: location.id });
    updated = await prisma.purchaseReference.findUniqueOrThrow({ where: { id: po.id } });
    expect(updated.status).toBe("RECEIVED");
    expect(await getBalance(material.id, location.id)).toBeCloseTo(2500, 6);
  });

  it("a receipt exceeding the PO's ordered quantity still succeeds — no validation, ever", async () => {
    const { location, material, supplier } = await setup();
    const po = await createPurchaseReference({ supplierId: supplier.id, materialId: material.id, orderedQuantity: 100 });

    const receipt = await createMaterialReceipt({ supplierId: supplier.id, purchaseReferenceId: po.id, materialId: material.id, receiptDate: new Date(), receivedQuantity: 150, acceptedQuantity: 150, destinationLocationId: location.id });
    expect(receipt.status).toBe("DRAFT");
  });

  it("cancelling a POSTED receipt reverses the accepted quantity without deleting the original transaction", async () => {
    const { location, material, supplier } = await setup();
    const receipt = await createAndPostMaterialReceipt({ supplierId: supplier.id, materialId: material.id, receiptDate: new Date(), receivedQuantity: 500, acceptedQuantity: 500, destinationLocationId: location.id });
    expect(await getBalance(material.id, location.id)).toBeCloseTo(500, 6);

    const cancelled = await cancelMaterialReceipt(receipt.id, "Supplier recalled batch");
    expect(cancelled.status).toBe("CANCELLED");
    expect(await getBalance(material.id, location.id)).toBeCloseTo(0, 6);

    // Original RECEIPT transaction must still exist, untouched — a reversal ADJUSTMENT was added, not a deletion.
    const originalTx = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: receipt.inventoryTransactionId! } });
    expect(originalTx.transactionType).toBe("RECEIPT");
    expect(originalTx.quantity).toBeCloseTo(500, 6);
    const reversalTx = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: cancelled.reversalTransactionId! } });
    expect(reversalTx.transactionType).toBe("ADJUSTMENT");
  });

  it("resolveSupplier reuses an existing supplier by name instead of creating a duplicate", async () => {
    const first = await resolveSupplier({ name: "Illawarra Coal Supply Co" });
    const second = await resolveSupplier({ name: "Illawarra Coal Supply Co" });
    expect(second.id).toBe(first.id);
  });
});
