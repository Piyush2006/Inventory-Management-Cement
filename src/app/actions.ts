"use server";

import { revalidatePath } from "next/cache";
import { postMovement, postAdjustment, postTransfer, postPacking } from "@/lib/inventory/ledger";
import { postProduction } from "@/lib/inventory/production";
import { recordPhysicalCount, postCountAdjustment } from "@/lib/inventory/reconciliation";
import {
  createStockRequest,
  acceptStockRequest,
  rejectStockRequest,
  cancelStockRequest,
  allocateStock,
  issueStock,
  confirmReceipt,
} from "@/lib/inventory/requests";
import {
  resolveSupplier,
  createPurchaseReference,
  createMaterialReceipt,
  createAndPostMaterialReceipt,
  postMaterialReceipt,
  cancelMaterialReceipt,
} from "@/lib/inventory/procurement";
import { getCurrentUser, setCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ADJUSTMENT_ROLES, FULFILMENT_ROLES, MASTER_DATA_ROLES, type TransactionType } from "@/lib/domain/enums";

function fail(message: string) {
  return { ok: false as const, error: message };
}
function ok<T extends object>(data?: T) {
  return { ok: true as const, ...(data ?? ({} as T)) };
}

function revalidateInventoryViews() {
  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath("/ledger");
  revalidatePath("/production");
}

// ---------------------------------------------------------------------------
// Record Movement
// ---------------------------------------------------------------------------

export async function actionRecordMovement(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, FULFILMENT_ROLES);
    const transactionType = String(formData.get("transactionType")) as TransactionType;
    const materialId = String(formData.get("materialId"));
    const quantity = Number(formData.get("quantity"));
    const reference = formData.get("reference") ? String(formData.get("reference")) : undefined;
    if (!materialId || Number.isNaN(quantity) || quantity <= 0) return fail("Missing required fields");

    const material = await prisma.material.findUniqueOrThrow({ where: { id: materialId } });

    if (transactionType === "TRANSFER") {
      const sourceLocationId = String(formData.get("sourceLocationId"));
      const destinationLocationId = String(formData.get("destinationLocationId"));
      if (!sourceLocationId || !destinationLocationId) return fail("Source and destination locations are required");
      await postTransfer({ materialId, quantity, uom: material.uom, sourceLocationId, destinationLocationId, reference });
    } else if (transactionType === "RECEIPT" || transactionType === "DISPATCH" || transactionType === "CONSUMPTION") {
      const locationId = String(formData.get("locationId"));
      if (!locationId) return fail("A location is required");
      const processName = formData.get("processName") ? String(formData.get("processName")) : undefined;
      await postMovement({ materialId, transactionType, quantity, uom: material.uom, locationId, reference, processName });
    } else {
      return fail(`${transactionType} is not handled by Record Movement — use the dedicated screen`);
    }

    revalidateInventoryViews();
    revalidatePath("/requests");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to record movement");
  }
}

export async function actionRecordPhysicalCount(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, FULFILMENT_ROLES);
    const locationId = String(formData.get("locationId"));
    const materialId = String(formData.get("materialId"));
    const countedQuantity = Number(formData.get("countedQuantity"));
    const countedBy = String(formData.get("countedBy") || "Demo User");
    const note = formData.get("note") ? String(formData.get("note")) : undefined;
    if (!locationId || !materialId || Number.isNaN(countedQuantity)) return fail("Missing required fields");

    const result = await recordPhysicalCount({ locationId, materialId, countedQuantity, countedBy, note });
    revalidatePath("/movements");
    return ok({ physicalCountId: result.count.id, preview: result.preview });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to record physical count");
  }
}

/**
 * Combines "record the count" and "post the adjustment" into one user action, matching
 * the spec's framing of Adjustment/Physical Count as a single feature: show book vs
 * counted stock and variance, then require a reason and confirmation before posting. A
 * reason is only required (and only an adjustment posted) when there's a nonzero variance.
 */
export async function actionRecordCountAndAdjust(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, FULFILMENT_ROLES);
    const locationId = String(formData.get("locationId"));
    const materialId = String(formData.get("materialId"));
    const countedQuantity = Number(formData.get("countedQuantity"));
    const countedBy = String(formData.get("countedBy") || "Demo User");
    const reason = formData.get("reason") ? String(formData.get("reason")) : "";
    const note = formData.get("note") ? String(formData.get("note")) : undefined;
    if (!locationId || !materialId || Number.isNaN(countedQuantity)) return fail("Missing required fields");

    const { count, preview } = await recordPhysicalCount({ locationId, materialId, countedQuantity, countedBy, note });
    const hasVariance = Math.abs(preview.varianceQty) > 1e-9;
    if (hasVariance) {
      if (!reason.trim()) return fail("A reason is required to post an adjustment");
      requireRole(user, ADJUSTMENT_ROLES);
      await postCountAdjustment({ physicalCountId: count.id, reason });
    }
    revalidateInventoryViews();
    return ok({ varianceQty: preview.varianceQty, adjusted: hasVariance });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to record count");
  }
}

export async function actionPostCountAdjustment(formData: FormData) {
  try {
    const physicalCountId = String(formData.get("physicalCountId"));
    const reason = String(formData.get("reason") || "");
    if (!physicalCountId || !reason.trim()) return fail("A reason is required to post an adjustment");
    const user = await getCurrentUser();
    requireRole(user, ADJUSTMENT_ROLES);
    await postCountAdjustment({ physicalCountId, reason });
    revalidateInventoryViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to post adjustment");
  }
}

export async function actionPostAdjustment(formData: FormData) {
  try {
    const materialId = String(formData.get("materialId"));
    const locationId = String(formData.get("locationId"));
    const quantity = Number(formData.get("quantity"));
    const reason = String(formData.get("reason") || "");
    if (!materialId || !locationId || Number.isNaN(quantity) || quantity === 0 || !reason.trim()) return fail("Missing required fields");

    const user = await getCurrentUser();
    requireRole(user, ADJUSTMENT_ROLES);
    const material = await prisma.material.findUniqueOrThrow({ where: { id: materialId } });
    await postAdjustment({ materialId, locationId, quantity, uom: material.uom, reason });
    revalidateInventoryViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to post adjustment");
  }
}

export async function actionPostPacking(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, FULFILMENT_ROLES);
    const bulkMaterialId = String(formData.get("bulkMaterialId"));
    const bulkLocationId = String(formData.get("bulkLocationId"));
    const bulkQuantity = Number(formData.get("bulkQuantity"));
    const bagMaterialId = String(formData.get("bagMaterialId"));
    const bagLocationId = String(formData.get("bagLocationId"));
    const baggedLocationId = String(formData.get("baggedLocationId"));
    if (!bulkMaterialId || !bulkLocationId || !bagMaterialId || !bagLocationId || !baggedLocationId || Number.isNaN(bulkQuantity) || bulkQuantity <= 0) {
      return fail("Missing required fields");
    }
    await postPacking({ bulkMaterialId, bulkLocationId, bulkQuantity, bagMaterialId, bagLocationId, baggedMaterialId: bulkMaterialId, baggedLocationId });
    revalidateInventoryViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to post packing run");
  }
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

export async function actionRecordProduction(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, FULFILMENT_ROLES);
    const outputMaterialId = String(formData.get("outputMaterialId"));
    const outputLocationId = String(formData.get("outputLocationId"));
    const quantity = Number(formData.get("quantity"));
    const processName = formData.get("processName") ? String(formData.get("processName")) : undefined;
    const note = formData.get("note") ? String(formData.get("note")) : undefined;
    if (!outputMaterialId || !outputLocationId || Number.isNaN(quantity) || quantity <= 0) return fail("Missing required fields");

    const result = await postProduction({ outputMaterialId, outputLocationId, quantity, processName, note });
    revalidateInventoryViews();
    return ok({ consumedInputs: result.consumedInputs });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to record production");
  }
}

// ---------------------------------------------------------------------------
// Stock Requests — full lifecycle
// ---------------------------------------------------------------------------

function revalidateRequestViews() {
  revalidatePath("/requests");
  revalidateInventoryViews();
}

export async function actionSetCurrentUser(formData: FormData) {
  try {
    const userId = String(formData.get("userId"));
    await setCurrentUser(userId);
    revalidatePath("/", "layout");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to switch user");
  }
}

export async function actionCreateStockRequest(formData: FormData) {
  try {
    const materialId = String(formData.get("materialId"));
    const quantityRequested = Number(formData.get("quantityRequested"));
    const requiredByDate = new Date(String(formData.get("requiredByDate")));
    const priority = String(formData.get("priority") || "NORMAL") as "NORMAL" | "URGENT";
    const reason = formData.get("reason") ? String(formData.get("reason")) : undefined;
    const note = formData.get("note") ? String(formData.get("note")) : undefined;
    const fromLocationId = String(formData.get("fromLocationId"));
    const toLocationId = String(formData.get("toLocationId"));
    if (!materialId || !fromLocationId || !toLocationId || Number.isNaN(quantityRequested) || quantityRequested <= 0 || isNaN(requiredByDate.getTime())) {
      return fail("Missing required fields");
    }
    const user = await getCurrentUser();
    await createStockRequest({ materialId, quantityRequested, requiredByDate, priority, reason, note, fromLocationId, toLocationId, requestedByUserId: user.id });
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to create request");
  }
}

export async function actionCancelStockRequest(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const user = await getCurrentUser();
    await cancelStockRequest(id, user.id);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to cancel request");
  }
}

export async function actionAcceptStockRequest(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const user = await getCurrentUser();
    await acceptStockRequest(id, user.id);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to accept request");
  }
}

export async function actionRejectStockRequest(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const reason = String(formData.get("reason") || "");
    if (!reason.trim()) return fail("A rejection reason is required");
    const user = await getCurrentUser();
    await rejectStockRequest(id, user.id, reason);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to reject request");
  }
}

export async function actionAllocateStock(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const quantity = Number(formData.get("quantity"));
    if (!id || Number.isNaN(quantity) || quantity <= 0) return fail("Missing required fields");
    const user = await getCurrentUser();
    await allocateStock(id, quantity, user.id);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to allocate stock");
  }
}

export async function actionIssueStock(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const quantity = Number(formData.get("quantity"));
    if (!id || Number.isNaN(quantity) || quantity <= 0) return fail("Missing required fields");
    const user = await getCurrentUser();
    await issueStock(id, quantity, user.id);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to issue stock");
  }
}

export async function actionConfirmReceipt(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const quantity = Number(formData.get("quantity"));
    if (!id || Number.isNaN(quantity) || quantity <= 0) return fail("Missing required fields");
    const user = await getCurrentUser();
    await confirmReceipt(id, quantity, user.id);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to confirm receipt");
  }
}

// ---------------------------------------------------------------------------
// Master data — Materials & Locations
// ---------------------------------------------------------------------------

export async function actionSaveMaterial(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, MASTER_DATA_ROLES);
    const id = formData.get("id") ? String(formData.get("id")) : undefined;
    const materialCode = String(formData.get("materialCode") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const category = String(formData.get("category") || "");
    const uom = String(formData.get("uom") || "");
    const minStock = formData.get("minStock") ? Number(formData.get("minStock")) : null;
    const safetyStock = formData.get("safetyStock") ? Number(formData.get("safetyStock")) : null;
    const defaultLocationId = formData.get("defaultLocationId") ? String(formData.get("defaultLocationId")) : null;
    const productGrade = formData.get("productGrade") ? String(formData.get("productGrade")) : null;
    const bagWeightKg = formData.get("bagWeightKg") ? Number(formData.get("bagWeightKg")) : null;
    const active = formData.get("active") === "on" || formData.get("active") === "true";

    if (!materialCode || !name || !category || !uom) return fail("Code, name, category, and UOM are required");

    const data = { materialCode, name, category, uom, minStock, safetyStock, defaultLocationId, productGrade, bagWeightKg, active };
    if (id) {
      await prisma.material.update({ where: { id }, data });
    } else {
      await prisma.material.create({ data });
    }
    revalidatePath("/master-data");
    revalidatePath("/inventory");
    revalidatePath("/");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to save material");
  }
}

export async function actionDeactivateMaterial(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, MASTER_DATA_ROLES);
    const id = String(formData.get("id"));
    const active = formData.get("active") === "true";
    await prisma.material.update({ where: { id }, data: { active } });
    revalidatePath("/master-data");
    revalidatePath("/inventory");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update material");
  }
}

export async function actionSaveLocation(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, MASTER_DATA_ROLES);
    const id = formData.get("id") ? String(formData.get("id")) : undefined;
    const name = String(formData.get("name") || "").trim();
    const type = String(formData.get("type") || "");
    const capacity = formData.get("capacity") ? Number(formData.get("capacity")) : null;
    const active = formData.get("active") === "on" || formData.get("active") === "true";

    if (!name || !type) return fail("Name and type are required");

    if (id) {
      await prisma.location.update({ where: { id }, data: { name, type, capacity, active } });
    } else {
      await prisma.location.create({ data: { name, type, capacity, active } });
    }
    revalidatePath("/master-data");
    revalidatePath("/inventory");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to save location");
  }
}

export async function actionDeactivateLocation(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, MASTER_DATA_ROLES);
    const id = String(formData.get("id"));
    const active = formData.get("active") === "true";
    const balance = await prisma.inventoryBalance.findFirst({ where: { locationId: id, quantity: { gt: 1e-6 } } });
    if (!active && balance) return fail("Cannot deactivate a location that still holds stock");
    await prisma.location.update({ where: { id }, data: { active } });
    revalidatePath("/master-data");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update location");
  }
}

// ---------------------------------------------------------------------------
// Procurement — Purchase References & Material Receipts (GRN)
// ---------------------------------------------------------------------------

function revalidateProcurementViews() {
  revalidateInventoryViews();
  revalidatePath("/receipts");
  revalidatePath("/requests");
}

async function resolveSupplierFromForm(formData: FormData) {
  const supplierId = formData.get("supplierId") ? String(formData.get("supplierId")) : undefined;
  const newSupplierName = formData.get("newSupplierName") ? String(formData.get("newSupplierName")) : undefined;
  const supplier = await resolveSupplier({
    supplierId: supplierId || undefined,
    name: newSupplierName,
    referenceCode: formData.get("supplierReferenceCode") ? String(formData.get("supplierReferenceCode")) : undefined,
    contactInfo: formData.get("supplierContact") ? String(formData.get("supplierContact")) : undefined,
  });
  return supplier;
}

export async function actionCreatePurchaseReference(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, FULFILMENT_ROLES);
    const supplier = await resolveSupplierFromForm(formData);
    const materialId = String(formData.get("materialId"));
    const orderedQuantity = Number(formData.get("orderedQuantity"));
    const expectedDeliveryDate = formData.get("expectedDeliveryDate") ? new Date(String(formData.get("expectedDeliveryDate"))) : undefined;
    const note = formData.get("note") ? String(formData.get("note")) : undefined;
    const stockRequestId = formData.get("stockRequestId") ? String(formData.get("stockRequestId")) : undefined;
    if (!materialId || Number.isNaN(orderedQuantity)) return fail("Missing required fields");

    const po = await createPurchaseReference({ supplierId: supplier.id, materialId, orderedQuantity, expectedDeliveryDate, note, stockRequestId });
    revalidatePath("/receipts");
    revalidatePath("/requests");
    return ok({ purchaseReferenceId: po.id, poNumber: po.poNumber });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to create purchase reference");
  }
}

function receiptInputFromForm(formData: FormData) {
  const purchaseReferenceId = formData.get("purchaseReferenceId") ? String(formData.get("purchaseReferenceId")) : undefined;
  const materialId = String(formData.get("materialId"));
  const receiptDate = formData.get("receiptDate") ? new Date(String(formData.get("receiptDate"))) : new Date();
  const receivedQuantity = Number(formData.get("receivedQuantity"));
  const acceptedQuantity = Number(formData.get("acceptedQuantity"));
  const rejectedRaw = formData.get("rejectedQuantity");
  const rejectedQuantity = rejectedRaw && String(rejectedRaw).trim() !== "" ? Number(rejectedRaw) : undefined;
  const destinationLocationId = String(formData.get("destinationLocationId"));
  const stockRequestId = formData.get("stockRequestId") ? String(formData.get("stockRequestId")) : undefined;
  const allowOverReceipt = formData.get("allowOverReceipt") === "on" || formData.get("allowOverReceipt") === "true";
  const invoiceDate = formData.get("invoiceDate") ? new Date(String(formData.get("invoiceDate"))) : undefined;
  const invoiceAmount = formData.get("invoiceAmount") ? Number(formData.get("invoiceAmount")) : undefined;

  return {
    purchaseReferenceId,
    materialId,
    receiptDate,
    receivedQuantity,
    acceptedQuantity,
    rejectedQuantity,
    destinationLocationId,
    batchLot: formData.get("batchLot") ? String(formData.get("batchLot")) : undefined,
    invoiceNumber: formData.get("invoiceNumber") ? String(formData.get("invoiceNumber")) : undefined,
    invoiceDate,
    invoiceAmount,
    deliveryNoteNumber: formData.get("deliveryNoteNumber") ? String(formData.get("deliveryNoteNumber")) : undefined,
    supplierChallan: formData.get("supplierChallan") ? String(formData.get("supplierChallan")) : undefined,
    vehicleReference: formData.get("vehicleReference") ? String(formData.get("vehicleReference")) : undefined,
    truckNumber: formData.get("truckNumber") ? String(formData.get("truckNumber")) : undefined,
    notes: formData.get("notes") ? String(formData.get("notes")) : undefined,
    stockRequestId,
    allowOverReceipt,
  };
}

/** Creates a Material Receipt / GRN — as DRAFT, or DRAFT-then-immediately-POSTED depending on `mode`. */
export async function actionCreateMaterialReceipt(formData: FormData) {
  try {
    const actingUser = await getCurrentUser();
    requireRole(actingUser, FULFILMENT_ROLES);
    const supplier = await resolveSupplierFromForm(formData);
    const mode = String(formData.get("mode") || "post"); // "draft" | "post"
    const input = receiptInputFromForm(formData);
    if (!input.materialId || !input.destinationLocationId || Number.isNaN(input.receivedQuantity) || Number.isNaN(input.acceptedQuantity)) {
      return fail("Missing required fields");
    }

    const receipt =
      mode === "draft"
        ? await createMaterialReceipt({ ...input, supplierId: supplier.id })
        : await createAndPostMaterialReceipt({ ...input, supplierId: supplier.id }, actingUser.id);

    revalidateProcurementViews();
    return ok({ receiptId: receipt.id, grnNumber: receipt.grnNumber, status: receipt.status });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to create receipt");
  }
}

export async function actionPostMaterialReceipt(formData: FormData) {
  try {
    const actingUser = await getCurrentUser();
    requireRole(actingUser, FULFILMENT_ROLES);
    const id = String(formData.get("id"));
    await postMaterialReceipt(id, actingUser.id);
    revalidateProcurementViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to post receipt");
  }
}

export async function actionCancelMaterialReceipt(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, FULFILMENT_ROLES);
    const id = String(formData.get("id"));
    const reason = String(formData.get("reason") || "");
    if (!reason.trim()) return fail("A reason is required to cancel a receipt");
    await cancelMaterialReceipt(id, reason);
    revalidateProcurementViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to cancel receipt");
  }
}
