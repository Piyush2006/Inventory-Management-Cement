import { describe, it, expect } from "vitest";
import { changeQualityStatus, getUnrestrictedAvailable, reconcileQualityBalances } from "@/lib/inventory/quality";
import { postMovement, postAdjustment } from "@/lib/inventory/ledger";
import { resolveSupplier, createAndPostMaterialReceipt } from "@/lib/inventory/procurement";
import { previewCount } from "@/lib/inventory/reconciliation";
import { makeLocation, makeMaterial, makeUser, getBalance } from "./helpers";
import { prisma } from "@/lib/db";

async function setup() {
  const location = await makeLocation();
  const material = await makeMaterial();
  const manager = await makeUser({ role: "INVENTORY_MANAGER" });
  return { location, material, manager };
}

describe("quality hold / release", () => {
  it("a GRN flagged QC_HOLD posts full inventory but excludes the quantity from Unrestricted", async () => {
    const { location, material } = await setup();
    const supplier = await resolveSupplier({ name: "QC Test Supplier" });

    const receipt = await createAndPostMaterialReceipt({
      supplierId: supplier.id, materialId: material.id, receiptDate: new Date(),
      receivedQuantity: 1500, acceptedQuantity: 1500, destinationLocationId: location.id, qualityStatus: "QC_HOLD",
    });

    expect(receipt.status).toBe("POSTED");
    expect(await getBalance(material.id, location.id)).toBeCloseTo(1500, 6); // On Hand unaffected
    expect(await getUnrestrictedAvailable(material.id, location.id)).toBeCloseTo(0, 6); // all of it is on hold

    const event = await prisma.qualityStatusEvent.findFirstOrThrow({ where: { materialId: material.id, locationId: location.id } });
    expect(event.fromStatus).toBe("UNRESTRICTED");
    expect(event.toStatus).toBe("QC_HOLD");
    expect(event.quantity).toBeCloseTo(1500, 6);
  });

  it("a GRN with no quality status specified defaults to fully Unrestricted", async () => {
    const { location, material } = await setup();
    const supplier = await resolveSupplier({ name: "QC Test Supplier 2" });
    await createAndPostMaterialReceipt({ supplierId: supplier.id, materialId: material.id, receiptDate: new Date(), receivedQuantity: 800, acceptedQuantity: 800, destinationLocationId: location.id });
    expect(await getUnrestrictedAvailable(material.id, location.id)).toBeCloseTo(800, 6);
  });

  it("Release moves quantity from QC Hold back to Unrestricted", async () => {
    const { location, material, manager } = await setup();
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 1000, uom: "MT", locationId: location.id });
    await changeQualityStatus({ materialId: material.id, locationId: location.id, quantity: 400, fromStatus: "UNRESTRICTED", toStatus: "QC_HOLD", userId: manager.id, reason: "Pending lab result" });
    expect(await getUnrestrictedAvailable(material.id, location.id)).toBeCloseTo(600, 6);

    await changeQualityStatus({ materialId: material.id, locationId: location.id, quantity: 400, fromStatus: "QC_HOLD", toStatus: "UNRESTRICTED", userId: manager.id, reason: "Lab cleared the batch" });
    expect(await getUnrestrictedAvailable(material.id, location.id)).toBeCloseTo(1000, 6);
  });

  it("releasing more than is currently on QC Hold still succeeds — no validation, clamps at 0 instead of going negative", async () => {
    const { location, material, manager } = await setup();
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 500, uom: "MT", locationId: location.id });
    await changeQualityStatus({ materialId: material.id, locationId: location.id, quantity: 100, fromStatus: "UNRESTRICTED", toStatus: "QC_HOLD", userId: manager.id, reason: "Hold" });

    await changeQualityStatus({ materialId: material.id, locationId: location.id, quantity: 200, fromStatus: "QC_HOLD", toStatus: "UNRESTRICTED", userId: manager.id });
    const qcHold = await prisma.qualityBalance.findUnique({ where: { materialId_locationId_status: { materialId: material.id, locationId: location.id, status: "QC_HOLD" } } });
    expect(qcHold?.quantity ?? 0).toBeCloseTo(0, 6); // clamped, not negative
  });

  it("holding/blocking more than is currently Unrestricted still succeeds — no validation, even though nothing tracks an UNRESTRICTED bucket directly", async () => {
    const { location, material, manager } = await setup();
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 300, uom: "MT", locationId: location.id });
    await changeQualityStatus({ materialId: material.id, locationId: location.id, quantity: 500, fromStatus: "UNRESTRICTED", toStatus: "QC_HOLD", userId: manager.id, reason: "Hold" });

    // On Hand is only 300, but 500 was put on hold — Unrestricted floors at 0 rather than going negative.
    expect(await getUnrestrictedAvailable(material.id, location.id)).toBeCloseTo(0, 6);
    const qcHold = await prisma.qualityBalance.findUnique({ where: { materialId_locationId_status: { materialId: material.id, locationId: location.id, status: "QC_HOLD" } } });
    expect(qcHold?.quantity).toBeCloseTo(500, 6);
  });

  it("reconcileQualityBalances shrinks an oversized QC Hold bucket after a large negative adjustment", async () => {
    const { location, material, manager } = await setup();
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 1000, uom: "MT", locationId: location.id });
    await changeQualityStatus({ materialId: material.id, locationId: location.id, quantity: 800, fromStatus: "UNRESTRICTED", toStatus: "QC_HOLD", userId: manager.id, reason: "Hold" });

    // A large negative adjustment (postAdjustment always allows going negative) drops On Hand below the recorded QC Hold.
    await postAdjustment({ materialId: material.id, locationId: location.id, quantity: -950, uom: "MT", reason: "Write-off" });
    expect(await getBalance(material.id, location.id)).toBeCloseTo(50, 6);

    await reconcileQualityBalances(material.id, location.id);
    const qcHold = await prisma.qualityBalance.findUnique({ where: { materialId_locationId_status: { materialId: material.id, locationId: location.id, status: "QC_HOLD" } } });
    expect(qcHold?.quantity ?? 0).toBeLessThanOrEqual(50 + 1e-6); // shrunk to fit On Hand
    expect(await getUnrestrictedAvailable(material.id, location.id)).toBeGreaterThanOrEqual(0);
  });
});

describe("physical count tolerance", () => {
  it("flags a variance within the default tolerance as within-tolerance, and a larger one as requiring investigation", async () => {
    const { location, material } = await setup();
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 1000, uom: "MT", locationId: location.id });

    const small = await previewCount(material.id, location.id, 1010); // +1% — within the 3% default
    expect(small.withinTolerance).toBe(true);
    expect(small.tolerancePct).toBeCloseTo(3, 6);

    const large = await previewCount(material.id, location.id, 1200); // +20% — beyond default tolerance
    expect(large.withinTolerance).toBe(false);
  });

  it("uses a material's own tolerancePct over the default when set", async () => {
    const location = await makeLocation();
    const material = await makeMaterial({ tolerancePct: 10 });
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 1000, uom: "MT", locationId: location.id });

    const preview = await previewCount(material.id, location.id, 1080); // +8% — beyond default 3% but within this material's 10%
    expect(preview.tolerancePct).toBeCloseTo(10, 6);
    expect(preview.withinTolerance).toBe(true);
  });
});
