"use server";

import { revalidatePath } from "next/cache";
import { postMovement, postAdjustment, postTransfer } from "@/lib/inventory/ledger";
import { recordPhysicalCount, postCountAdjustment } from "@/lib/inventory/reconciliation";
import { changeQualityStatus, reconcileQualityBalances } from "@/lib/inventory/quality";
import {
  createStockRequest,
  acceptStockRequest,
  rejectStockRequest,
  routeToSupervisor,
  assignOperator,
  startDelivery,
  markDelivered,
  confirmReceipt,
  markNotReceived,
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
import { ADJUSTMENT_ROLES, STOCK_OPS_ROLES, MASTER_DATA_ROLES, type TransactionType, type QualityStatus } from "@/lib/domain/enums";

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
}

// ---------------------------------------------------------------------------
// Stock Operations — Receive Material / Consume / Transfer / Adjustment
// ---------------------------------------------------------------------------

export async function actionRecordMovement(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, STOCK_OPS_ROLES);
    const transactionType = String(formData.get("transactionType")) as TransactionType;
    const materialId = String(formData.get("materialId"));
    const quantity = Number(formData.get("quantity"));
    const reference = formData.get("reference") ? String(formData.get("reference")) : undefined;
    if (!materialId || Number.isNaN(quantity) || quantity <= 0) return fail("Missing required fields");

    const material = await prisma.material.findUniqueOrThrow({ where: { id: materialId } });
    if (!material.active) return fail(`${material.name} is not active`);

    if (transactionType === "TRANSFER") {
      const sourceLocationId = String(formData.get("sourceLocationId"));
      const destinationLocationId = String(formData.get("destinationLocationId"));
      if (!sourceLocationId || !destinationLocationId) return fail("Source and destination locations are required");
      const [sourceLocation, destinationLocation] = await Promise.all([
        prisma.location.findUniqueOrThrow({ where: { id: sourceLocationId } }),
        prisma.location.findUniqueOrThrow({ where: { id: destinationLocationId } }),
      ]);
      if (!sourceLocation.active || !destinationLocation.active) return fail("Source and destination locations must both be active");
      await postTransfer({ materialId, quantity, uom: material.uom, sourceLocationId, destinationLocationId, reference });
    } else if (transactionType === "CONSUMPTION") {
      const locationId = String(formData.get("locationId"));
      if (!locationId) return fail("A location is required");
      const location = await prisma.location.findUniqueOrThrow({ where: { id: locationId } });
      if (!location.active) return fail(`${location.name} is not active`);
      const processName = formData.get("processName") ? String(formData.get("processName")) : undefined;
      await postMovement({ materialId, transactionType, quantity, uom: material.uom, locationId, reference, processName });
    } else {
      return fail(`${transactionType} is not handled by this form`);
    }

    revalidateInventoryViews();
    revalidatePath("/movements");
    revalidatePath("/requests");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to record movement");
  }
}

export async function actionRecordPhysicalCount(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, STOCK_OPS_ROLES);
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
 * Combines "record the count" and "post the adjustment" into one user action: show book
 * vs counted stock and variance, then require a reason and confirmation before posting.
 * A reason is only required (and only an adjustment posted) when there's a nonzero
 * variance. Posting still requires ADJUSTMENT_ROLES (Inventory Manager/Admin) — but a
 * variance from anyone else now records the count and leaves it pending approval instead
 * of failing outright, so a Store Operator can complete their count and hand it off. See
 * the "Pending Physical Counts" panel (actionPostCountAdjustment) for the approval step.
 */
export async function actionRecordCountAndAdjust(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, STOCK_OPS_ROLES);
    const locationId = String(formData.get("locationId"));
    const materialId = String(formData.get("materialId"));
    const countedQuantity = Number(formData.get("countedQuantity"));
    const countedBy = String(formData.get("countedBy") || "Demo User");
    const reason = formData.get("reason") ? String(formData.get("reason")) : "";
    const note = formData.get("note") ? String(formData.get("note")) : undefined;
    if (!locationId || !materialId || Number.isNaN(countedQuantity)) return fail("Missing required fields");

    const { count, preview } = await recordPhysicalCount({ locationId, materialId, countedQuantity, countedBy, note });
    const hasVariance = Math.abs(preview.varianceQty) > 1e-9;
    const canApprove = ADJUSTMENT_ROLES.includes(user.role as (typeof ADJUSTMENT_ROLES)[number]);
    let adjusted = false;
    if (hasVariance && canApprove) {
      if (!reason.trim()) return fail("A reason is required to post an adjustment");
      await postCountAdjustment({ physicalCountId: count.id, reason });
      adjusted = true;
    }
    revalidateInventoryViews();
    revalidatePath("/movements");
    return ok({ varianceQty: preview.varianceQty, adjusted, pendingApproval: hasVariance && !canApprove, tolerancePct: preview.tolerancePct, withinTolerance: preview.withinTolerance });
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
    const [material, location] = await Promise.all([
      prisma.material.findUniqueOrThrow({ where: { id: materialId } }),
      prisma.location.findUniqueOrThrow({ where: { id: locationId } }),
    ]);
    if (!material.active) return fail(`${material.name} is not active`);
    if (!location.active) return fail(`${location.name} is not active`);
    await postAdjustment({ materialId, locationId, quantity, uom: material.uom, reason });
    // postAdjustment always bypasses the negative-balance guard — if this location had QC
    // Hold/Blocked stock, a large enough negative adjustment can drop On Hand below it.
    await reconcileQualityBalances(materialId, locationId);
    revalidateInventoryViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to post adjustment");
  }
}

/** Release (-> Unrestricted), Hold, or Block a quantity of a material at a location. Inventory Manager/Admin only — matches the spec's "other roles: view only". */
export async function actionChangeQualityStatus(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, ADJUSTMENT_ROLES);
    const materialId = String(formData.get("materialId"));
    const locationId = String(formData.get("locationId"));
    const quantity = Number(formData.get("quantity"));
    const fromStatus = String(formData.get("fromStatus")) as QualityStatus;
    const toStatus = String(formData.get("toStatus")) as QualityStatus;
    const reason = formData.get("reason") ? String(formData.get("reason")) : "";
    if (!materialId || !locationId || Number.isNaN(quantity) || quantity <= 0 || !fromStatus || !toStatus) return fail("Missing required fields");
    if (toStatus !== "UNRESTRICTED" && !reason.trim()) return fail("A reason is required to hold or block stock");

    await changeQualityStatus({ materialId, locationId, quantity, fromStatus, toStatus, userId: user.id, reason: reason || undefined });
    revalidateInventoryViews();
    revalidatePath(`/inventory/${materialId}`);
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to change quality status");
  }
}

// ---------------------------------------------------------------------------
// Requests — full role-based lifecycle
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

export async function actionRouteToSupervisor(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const supervisorUserId = String(formData.get("supervisorUserId"));
    if (!id || !supervisorUserId) return fail("Choose a Store Supervisor to route to");
    const user = await getCurrentUser();
    await routeToSupervisor(id, supervisorUserId, user.id);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to route request");
  }
}

export async function actionAssignOperator(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const operatorUserId = String(formData.get("operatorUserId"));
    if (!id || !operatorUserId) return fail("Choose an operator to assign");
    const user = await getCurrentUser();
    await assignOperator(id, operatorUserId, user.id);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to assign operator");
  }
}

export async function actionStartDelivery(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const user = await getCurrentUser();
    await startDelivery(id, user.id);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to start delivery");
  }
}

export async function actionMarkDelivered(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const deliveryNote = formData.get("deliveryNote") ? String(formData.get("deliveryNote")) : undefined;
    const user = await getCurrentUser();
    await markDelivered(id, user.id, deliveryNote);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to mark delivered");
  }
}

export async function actionConfirmReceipt(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const quantity = Number(formData.get("quantity"));
    const note = formData.get("note") ? String(formData.get("note")) : undefined;
    if (!id || Number.isNaN(quantity) || quantity <= 0) return fail("Missing required fields");
    const user = await getCurrentUser();
    await confirmReceipt(id, quantity, user.id, note);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to confirm receipt");
  }
}

export async function actionMarkNotReceived(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const reason = String(formData.get("reason") || "");
    if (!reason.trim()) return fail("A reason is required");
    const user = await getCurrentUser();
    await markNotReceived(id, user.id, reason);
    revalidateRequestViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to record not received");
  }
}

// ---------------------------------------------------------------------------
// Locations & Materials
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
    const active = formData.get("active") === "on" || formData.get("active") === "true";

    if (!materialCode || !name || !category || !uom) return fail("Code, name, category, and UOM are required");

    const data = { materialCode, name, category, uom, minStock, safetyStock, defaultLocationId, active };
    if (id) {
      await prisma.material.update({ where: { id }, data });
    } else {
      await prisma.material.create({ data });
    }
    revalidatePath("/materials");
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
    revalidatePath("/materials");
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
    revalidatePath("/locations");
    revalidatePath("/materials");
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
    revalidatePath("/locations");
    revalidatePath("/materials");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update location");
  }
}

// ---------------------------------------------------------------------------
// Receive Material — Purchase/Source References & GRN
// ---------------------------------------------------------------------------

function revalidateProcurementViews() {
  revalidateInventoryViews();
  revalidatePath("/receipts");
  revalidatePath("/movements");
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
    requireRole(user, STOCK_OPS_ROLES);
    const supplier = await resolveSupplierFromForm(formData);
    const materialId = String(formData.get("materialId"));
    const orderedQuantity = Number(formData.get("orderedQuantity"));
    const expectedDeliveryDate = formData.get("expectedDeliveryDate") ? new Date(String(formData.get("expectedDeliveryDate"))) : undefined;
    const note = formData.get("note") ? String(formData.get("note")) : undefined;
    if (!materialId || Number.isNaN(orderedQuantity)) return fail("Missing required fields");

    const po = await createPurchaseReference({ supplierId: supplier.id, materialId, orderedQuantity, expectedDeliveryDate, note });
    revalidatePath("/receipts");
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
  const qualityStatus = (formData.get("qualityStatus") ? String(formData.get("qualityStatus")) : "UNRESTRICTED") as QualityStatus;
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
    qualityStatus,
    batchLot: formData.get("batchLot") ? String(formData.get("batchLot")) : undefined,
    invoiceNumber: formData.get("invoiceNumber") ? String(formData.get("invoiceNumber")) : undefined,
    invoiceDate,
    invoiceAmount,
    deliveryNoteNumber: formData.get("deliveryNoteNumber") ? String(formData.get("deliveryNoteNumber")) : undefined,
    supplierChallan: formData.get("supplierChallan") ? String(formData.get("supplierChallan")) : undefined,
    vehicleReference: formData.get("vehicleReference") ? String(formData.get("vehicleReference")) : undefined,
    truckNumber: formData.get("truckNumber") ? String(formData.get("truckNumber")) : undefined,
    notes: formData.get("notes") ? String(formData.get("notes")) : undefined,
    allowOverReceipt,
  };
}

/** Creates a Material Receipt / GRN — as DRAFT, or DRAFT-then-immediately-POSTED depending on `mode`. */
export async function actionCreateMaterialReceipt(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, STOCK_OPS_ROLES);
    const supplier = await resolveSupplierFromForm(formData);
    const mode = String(formData.get("mode") || "post"); // "draft" | "post"
    const input = receiptInputFromForm(formData);
    if (!input.materialId || !input.destinationLocationId || Number.isNaN(input.receivedQuantity) || Number.isNaN(input.acceptedQuantity)) {
      return fail("Missing required fields");
    }

    const receipt =
      mode === "draft"
        ? await createMaterialReceipt({ ...input, supplierId: supplier.id })
        : await createAndPostMaterialReceipt({ ...input, supplierId: supplier.id }, user.id);

    revalidateProcurementViews();
    return ok({ receiptId: receipt.id, grnNumber: receipt.grnNumber, status: receipt.status });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to create receipt");
  }
}

export async function actionPostMaterialReceipt(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, STOCK_OPS_ROLES);
    const id = String(formData.get("id"));
    await postMaterialReceipt(id, user.id);
    revalidateProcurementViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to post receipt");
  }
}

export async function actionCancelMaterialReceipt(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, STOCK_OPS_ROLES);
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
