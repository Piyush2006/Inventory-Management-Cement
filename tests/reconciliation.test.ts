import { describe, it, expect } from "vitest";
import { postMovement } from "@/lib/inventory/ledger";
import { previewCount, recordPhysicalCount, postCountAdjustment } from "@/lib/inventory/reconciliation";
import { getBalance } from "./helpers";
import { makeLocation, makeMaterial } from "./helpers";
import { prisma } from "@/lib/db";

describe("physical count & adjustment", () => {
  it("computes variance quantity and percentage against book stock", async () => {
    const location = await makeLocation({ type: "STOCKPILE" });
    const material = await makeMaterial();
    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 40000, uom: "MT", locationId: location.id });

    const preview = await previewCount(material.id, location.id, 38800);
    expect(preview.bookQuantity).toBeCloseTo(40000, 6);
    expect(preview.varianceQty).toBeCloseTo(-1200, 6);
    expect(preview.variancePct).toBeCloseTo(-3.0, 6);
  });

  it("recording a count alone never changes stock", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();
    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 40000, uom: "MT", locationId: location.id });

    await recordPhysicalCount({ locationId: location.id, materialId: material.id, countedQuantity: 38800, countedBy: "Test" });
    expect(await getBalance(material.id, location.id)).toBeCloseTo(40000, 6);
  });

  it("posting the adjustment brings book stock to match the physical count and is fully audited", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();
    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 40000, uom: "MT", locationId: location.id });

    const { count } = await recordPhysicalCount({ locationId: location.id, materialId: material.id, countedQuantity: 38800, countedBy: "Test" });
    await postCountAdjustment({ physicalCountId: count.id, reason: "Volumetric survey correction" });

    expect(await getBalance(material.id, location.id)).toBeCloseTo(38800, 6);
    const updated = await prisma.physicalCount.findUniqueOrThrow({ where: { id: count.id } });
    expect(updated.adjustmentTransactionId).toBeTruthy();

    const tx = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: updated.adjustmentTransactionId! } });
    expect(tx.transactionType).toBe("ADJUSTMENT");
    expect(tx.reason).toBe("Volumetric survey correction");
  });

  it("rejects posting an adjustment when there is no variance", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();
    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 1000, uom: "MT", locationId: location.id });

    const { count } = await recordPhysicalCount({ locationId: location.id, materialId: material.id, countedQuantity: 1000, countedBy: "Test" });
    await expect(postCountAdjustment({ physicalCountId: count.id, reason: "No-op" })).rejects.toThrow();
  });
});
