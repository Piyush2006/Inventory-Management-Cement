import { prisma } from "@/lib/db";
import { postMovement, postAdjustment } from "@/lib/inventory/ledger";
import { assertExternalReceiptAllowed, applyExternalReceipt } from "@/lib/inventory/requests";
import { getCurrentUser } from "@/lib/auth";

export class ProcurementError extends Error {}

function generateNumber(prefix: string) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** Finds an existing active supplier by exact name, or creates one — the "simple selection/input" the spec asks for, not a full supplier module. */
export async function resolveSupplier(input: { supplierId?: string; name?: string; referenceCode?: string; contactInfo?: string }) {
  if (input.supplierId) return prisma.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });
  if (!input.name?.trim()) throw new ProcurementError("A supplier is required");
  const existing = await prisma.supplier.findFirst({ where: { name: input.name.trim() } });
  if (existing) return existing;
  return prisma.supplier.create({ data: { name: input.name.trim(), referenceCode: input.referenceCode, contactInfo: input.contactInfo } });
}

/**
 * Cumulative-accepted-quantity status: EXPECTED (nothing accepted yet), PARTIALLY_RECEIVED
 * (some but not all), RECEIVED (accepted >= ordered) — matches the spec's own worked
 * example, which ties "remaining" to accepted quantity, not received or ordered.
 */
export async function recomputePurchaseReferenceStatus(purchaseReferenceId: string) {
  const po = await prisma.purchaseReference.findUniqueOrThrow({ where: { id: purchaseReferenceId } });
  if (po.status === "CANCELLED") return po;
  const posted = await prisma.materialReceipt.findMany({ where: { purchaseReferenceId, status: "POSTED" } });
  const totalAccepted = posted.reduce((s, r) => s + r.acceptedQuantity, 0);
  const status = totalAccepted <= 1e-9 ? "EXPECTED" : totalAccepted >= po.orderedQuantity - 1e-6 ? "RECEIVED" : "PARTIALLY_RECEIVED";
  return prisma.purchaseReference.update({ where: { id: purchaseReferenceId }, data: { status } });
}

export async function createPurchaseReference(input: {
  supplierId: string;
  materialId: string;
  orderedQuantity: number;
  expectedDeliveryDate?: Date;
  note?: string;
  stockRequestId?: string;
}) {
  if (input.orderedQuantity <= 0) throw new ProcurementError("Ordered quantity must be greater than zero");
  return prisma.purchaseReference.create({
    data: {
      poNumber: generateNumber("PO"),
      supplierId: input.supplierId,
      materialId: input.materialId,
      orderedQuantity: input.orderedQuantity,
      expectedDeliveryDate: input.expectedDeliveryDate,
      note: input.note,
      stockRequestId: input.stockRequestId,
      status: "EXPECTED",
    },
  });
}

export interface CreateReceiptInput {
  supplierId: string;
  purchaseReferenceId?: string;
  materialId: string;
  receiptDate: Date;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity?: number; // if omitted, derived as receivedQuantity - acceptedQuantity
  destinationLocationId: string;
  batchLot?: string;
  invoiceNumber?: string;
  invoiceDate?: Date;
  invoiceAmount?: number;
  deliveryNoteNumber?: string;
  supplierChallan?: string;
  vehicleReference?: string;
  truckNumber?: string;
  notes?: string;
  stockRequestId?: string;
  allowOverReceipt?: boolean;
}

async function validateReceiptQuantities(input: CreateReceiptInput) {
  if (input.receivedQuantity <= 0) throw new ProcurementError("Received quantity must be greater than zero");
  if (input.acceptedQuantity < 0) throw new ProcurementError("Accepted quantity cannot be negative");
  const rejected = input.rejectedQuantity ?? input.receivedQuantity - input.acceptedQuantity;
  if (rejected < -1e-6) throw new ProcurementError("Rejected quantity cannot be negative");
  if (input.acceptedQuantity > input.receivedQuantity + 1e-6) throw new ProcurementError("Accepted quantity cannot exceed received quantity");
  if (Math.abs(input.acceptedQuantity + rejected - input.receivedQuantity) > 1e-6) {
    throw new ProcurementError("Accepted + Rejected must equal Received");
  }

  const material = await prisma.material.findUniqueOrThrow({ where: { id: input.materialId } });
  if (!material.active) throw new ProcurementError("Material is not active");
  const location = await prisma.location.findUniqueOrThrow({ where: { id: input.destinationLocationId } });
  if (!location.active) throw new ProcurementError("Destination location is not active");

  if (input.purchaseReferenceId && !input.allowOverReceipt) {
    const po = await prisma.purchaseReference.findUniqueOrThrow({ where: { id: input.purchaseReferenceId } });
    const priorReceived = await prisma.materialReceipt.aggregate({
      where: { purchaseReferenceId: input.purchaseReferenceId, status: { in: ["DRAFT", "POSTED"] } },
      _sum: { receivedQuantity: true },
    });
    const already = priorReceived._sum.receivedQuantity ?? 0;
    if (already + input.receivedQuantity > po.orderedQuantity + 1e-6) {
      throw new ProcurementError(
        `Received quantity would exceed the ordered quantity on ${po.poNumber} (${already.toLocaleString()} already received/drafted of ${po.orderedQuantity.toLocaleString()} ordered). Tick "allow over-receipt" to proceed anyway.`
      );
    }
  }

  return rejected;
}

/** Creates a GRN as DRAFT. A draft never touches inventory — use postMaterialReceipt to post it. */
export async function createMaterialReceipt(input: CreateReceiptInput) {
  const rejectedQuantity = await validateReceiptQuantities(input);

  const orderedQuantitySnapshot = input.purchaseReferenceId
    ? (await prisma.purchaseReference.findUnique({ where: { id: input.purchaseReferenceId } }))?.orderedQuantity
    : undefined;

  return prisma.materialReceipt.create({
    data: {
      grnNumber: generateNumber("GRN"),
      receiptDate: input.receiptDate,
      supplierId: input.supplierId,
      purchaseReferenceId: input.purchaseReferenceId,
      materialId: input.materialId,
      orderedQuantitySnapshot,
      receivedQuantity: input.receivedQuantity,
      acceptedQuantity: input.acceptedQuantity,
      rejectedQuantity,
      destinationLocationId: input.destinationLocationId,
      batchLot: input.batchLot,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      invoiceAmount: input.invoiceAmount,
      deliveryNoteNumber: input.deliveryNoteNumber,
      supplierChallan: input.supplierChallan,
      vehicleReference: input.vehicleReference,
      truckNumber: input.truckNumber,
      notes: input.notes,
      stockRequestId: input.stockRequestId,
      status: "DRAFT",
    },
  });
}

/**
 * Posts a DRAFT GRN: increases inventory by acceptedQuantity ONLY (never ordered or
 * received), links the ledger row back to the GRN, rolls the linked PO's status
 * forward, and — if the GRN was raised against a stock request — fulfils it too.
 */
export async function postMaterialReceipt(receiptId: string, actingUserId?: string) {
  const receipt = await prisma.materialReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { material: true } });
  if (receipt.status !== "DRAFT") throw new ProcurementError(`Only a DRAFT receipt can be posted (this one is ${receipt.status})`);

  // Re-validate at posting time in case the PO or other receipts changed since the draft was created.
  await validateReceiptQuantities({
    supplierId: receipt.supplierId,
    purchaseReferenceId: receipt.purchaseReferenceId ?? undefined,
    materialId: receipt.materialId,
    receiptDate: receipt.receiptDate,
    receivedQuantity: receipt.receivedQuantity,
    acceptedQuantity: receipt.acceptedQuantity,
    rejectedQuantity: receipt.rejectedQuantity,
    destinationLocationId: receipt.destinationLocationId,
    allowOverReceipt: true, // this draft already reserved its share when created
  });

  if (receipt.stockRequestId && receipt.acceptedQuantity > 0) {
    await assertExternalReceiptAllowed(receipt.stockRequestId, receipt.acceptedQuantity);
  }

  let tx = null;
  if (receipt.acceptedQuantity > 0) {
    tx = await postMovement({
      materialId: receipt.materialId,
      transactionType: "RECEIPT",
      quantity: receipt.acceptedQuantity,
      uom: receipt.material.uom,
      locationId: receipt.destinationLocationId,
      timestamp: receipt.receiptDate,
      reference: receipt.grnNumber,
      batchLot: receipt.batchLot ?? undefined,
    });
  }

  const updated = await prisma.materialReceipt.update({
    where: { id: receipt.id },
    data: { status: "POSTED", postedAt: new Date(), inventoryTransactionId: tx?.id },
  });

  if (receipt.purchaseReferenceId) await recomputePurchaseReferenceStatus(receipt.purchaseReferenceId);
  if (receipt.stockRequestId && tx && receipt.acceptedQuantity > 0) {
    const resolvedUserId = actingUserId ?? (await getCurrentUser()).id;
    await applyExternalReceipt({ requestId: receipt.stockRequestId, quantity: receipt.acceptedQuantity, actingUserId: resolvedUserId });
  }

  return updated;
}

/** Convenience: create + immediately post in one call, for the common "receive now" case. */
export async function createAndPostMaterialReceipt(input: CreateReceiptInput, actingUserId?: string) {
  const receipt = await createMaterialReceipt(input);
  return postMaterialReceipt(receipt.id, actingUserId);
}

/**
 * Cancels a POSTED receipt without deleting history: the original RECEIPT transaction
 * stays exactly as it was, and an audited ADJUSTMENT reverses the accepted quantity back
 * out of stock. A DRAFT receipt can simply be cancelled with no ledger impact at all.
 */
export async function cancelMaterialReceipt(receiptId: string, reason: string) {
  if (!reason?.trim()) throw new ProcurementError("A reason is required to cancel a receipt");
  const receipt = await prisma.materialReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { material: true } });
  if (receipt.status === "CANCELLED") throw new ProcurementError("Receipt is already cancelled");

  if (receipt.status === "POSTED" && receipt.acceptedQuantity > 0) {
    const reversal = await postAdjustment({
      materialId: receipt.materialId,
      locationId: receipt.destinationLocationId,
      quantity: -receipt.acceptedQuantity,
      uom: receipt.material.uom,
      reason: `Reversal of cancelled receipt ${receipt.grnNumber}: ${reason}`,
      reference: receipt.grnNumber,
    });
    await prisma.materialReceipt.update({ where: { id: receipt.id }, data: { status: "CANCELLED", reversalTransactionId: reversal.id } });
  } else {
    await prisma.materialReceipt.update({ where: { id: receipt.id }, data: { status: "CANCELLED" } });
  }

  if (receipt.purchaseReferenceId) await recomputePurchaseReferenceStatus(receipt.purchaseReferenceId);
  return prisma.materialReceipt.findUniqueOrThrow({ where: { id: receiptId } });
}
