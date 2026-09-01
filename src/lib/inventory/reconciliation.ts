import { prisma } from "@/lib/db";
import { getLocationOnHand } from "@/lib/inventory/balance";
import { postAdjustment } from "@/lib/inventory/ledger";

export interface CountPreview {
  bookQuantity: number;
  countedQuantity: number;
  varianceQty: number;
  variancePct: number;
}

export async function previewCount(materialId: string, locationId: string, countedQuantity: number): Promise<CountPreview> {
  const bookQuantity = await getLocationOnHand(materialId, locationId);
  const varianceQty = countedQuantity - bookQuantity;
  const variancePct = bookQuantity === 0 ? (varianceQty === 0 ? 0 : 100) : (varianceQty / bookQuantity) * 100;
  return { bookQuantity, countedQuantity, varianceQty, variancePct };
}

/** Records a physical count observation. Recording alone never changes stock — posting the adjustment does that, and requires explicit confirmation. */
export async function recordPhysicalCount(input: { locationId: string; materialId: string; countedQuantity: number; countedBy: string; note?: string }) {
  const preview = await previewCount(input.materialId, input.locationId, input.countedQuantity);
  const count = await prisma.physicalCount.create({
    data: {
      locationId: input.locationId,
      materialId: input.materialId,
      countedQuantity: input.countedQuantity,
      bookQuantityAtCount: preview.bookQuantity,
      countedBy: input.countedBy,
      countedAt: new Date(),
      note: input.note,
    },
  });
  return { count, preview };
}

/** Posts the ADJUSTMENT implied by a physical count and links it back for audit. */
export async function postCountAdjustment(input: { physicalCountId: string; reason: string; userId?: string }) {
  const count = await prisma.physicalCount.findUniqueOrThrow({ where: { id: input.physicalCountId }, include: { material: true } });
  const varianceQty = count.countedQuantity - count.bookQuantityAtCount;
  if (Math.abs(varianceQty) < 1e-9) throw new Error("No variance to adjust");

  const tx = await postAdjustment({
    materialId: count.materialId,
    locationId: count.locationId,
    quantity: varianceQty,
    uom: count.material.uom,
    reason: input.reason,
    userId: input.userId,
    reference: `PHYSICAL_COUNT:${count.id}`,
  });

  await prisma.physicalCount.update({ where: { id: count.id }, data: { adjustmentTransactionId: tx.id } });
  return tx;
}
