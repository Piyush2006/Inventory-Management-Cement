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
import {
  createDispatch,
  approveDispatch,
  reassignDispatchOperator,
  startDispatchLoading,
  markDispatched,
  cancelDispatch,
} from "@/lib/inventory/dispatch";
import { getCurrentUser, setCurrentUser, clearCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ADJUSTMENT_ROLES, STOCK_OPS_ROLES, MASTER_DATA_ROLES, NOTIFICATION_CONFIG_ROLES, REPORT_TYPES, REPORT_SCHEDULE_FREQUENCIES, REPORT_SCHEDULE_RECIPIENT_TYPES, REPORT_TYPE_LABELS, DAYS_OF_WEEK, ADMIN_ROLE, USER_ROLES, type TransactionType, type QualityStatus, type UserRole } from "@/lib/domain/enums";
import { triggerNotification } from "@/lib/notifications/engine";
import { checkStockThresholds } from "@/lib/notifications/stockThreshold";
import type { NotificationEvent } from "@/lib/notifications/events";
import { sendEmail } from "@/lib/notifications/email";
import { answerBruceQuestion } from "@/lib/bruce/answer";
import { postSpareReturn } from "@/lib/inventory/spareReturn";
import type { ReturnCondition } from "@/lib/domain/enums";

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

    await checkStockThresholds(materialId);
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
      await checkStockThresholds(materialId);
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
    const tx = await postCountAdjustment({ physicalCountId, reason });
    await checkStockThresholds(tx.materialId);
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
    await checkStockThresholds(materialId);
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
    if (fromStatus === "QC_HOLD" && toStatus === "UNRESTRICTED") {
      await triggerNotification("QUALITY_RELEASED", { recordId: materialId, materialId, locationId, quantity, link: `/inventory/${materialId}` });
    }
    // A hold/block can reduce Unrestricted stock enough to cross into Low/Critical even though
    // On Hand hasn't changed — check regardless of direction, not just on release.
    await checkStockThresholds(materialId);
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

// Shared notification context builder for every Request lifecycle hook below — `updated` is
// always the bare record `prisma.stockRequest.update()` returns, whose scalar FKs are exactly
// what triggerNotification's RELEVANT_USER resolvers need (see src/lib/notifications/recipients.ts).
function requestNotificationContext(updated: {
  id: string;
  materialId: string;
  quantityRequested: number;
  requestNumber: string;
  requestedByUserId: string;
  assignedToUserId: string | null;
  routedToUserId: string | null;
  requestType: string;
}) {
  return {
    recordId: updated.id,
    materialId: updated.materialId,
    quantity: updated.quantityRequested,
    reference: updated.requestNumber,
    requestedByUserId: updated.requestedByUserId,
    assignedToUserId: updated.assignedToUserId ?? undefined,
    routedToUserId: updated.routedToUserId ?? undefined,
    requestType: updated.requestType,
    link: `/requests/${updated.id}`,
  };
}

// ---------------------------------------------------------------------------
// Users & Roles — Admin-only management of existing User records, plus the demo
// "Login as User" session switch (the same currentUserId cookie mechanism that always
// existed here, now actually gated — previously any session could switch to any user).
// ---------------------------------------------------------------------------

export async function actionLoginAsUser(formData: FormData) {
  try {
    const actingUser = await getCurrentUser();
    requireRole(actingUser, [ADMIN_ROLE]);
    const userId = String(formData.get("userId") || "");
    if (!userId) return fail("Missing user");
    const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!target.active) return fail(`${target.name} is not active`);
    await setCurrentUser(target.id);
    revalidatePath("/", "layout");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to switch user");
  }
}

export async function actionLogout() {
  try {
    await clearCurrentUser();
    revalidatePath("/", "layout");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to log out");
  }
}

export async function actionUpdateUser(formData: FormData) {
  try {
    const actingUser = await getCurrentUser();
    requireRole(actingUser, [ADMIN_ROLE]);
    const id = String(formData.get("id") || "");
    const name = String(formData.get("name") || "").trim();
    const role = String(formData.get("role") || "") as UserRole;
    const email = formData.get("email") ? String(formData.get("email")).trim() : null;
    if (!id || !name || !role) return fail("Missing required fields");
    if (!(USER_ROLES as readonly string[]).includes(role)) return fail("Invalid role");
    await prisma.user.update({ where: { id }, data: { name, role, email } });
    revalidatePath("/users");
    revalidatePath("/", "layout");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update user");
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
    const requestType = (String(formData.get("requestType") || "MATERIAL")) as "MATERIAL" | "SPARE";
    const equipmentRef = formData.get("equipmentRef") ? String(formData.get("equipmentRef")) : undefined;
    const purpose = (String(formData.get("purpose") || "TRANSFER")) as "TRANSFER" | "ISSUE";
    const toLocationId = purpose === "TRANSFER" ? String(formData.get("toLocationId")) : undefined;
    const issuedTo = purpose === "ISSUE" ? String(formData.get("issuedTo") || "") : undefined;
    if (!materialId || !fromLocationId || Number.isNaN(quantityRequested) || quantityRequested <= 0 || isNaN(requiredByDate.getTime())) {
      return fail("Missing required fields");
    }
    if (purpose === "TRANSFER" && !toLocationId) return fail("A To location is required for a Transfer request");
    if (purpose === "ISSUE" && !issuedTo?.trim()) return fail("Issued To is required for an Issue request");
    const user = await getCurrentUser();
    const request = await createStockRequest({ materialId, quantityRequested, requiredByDate, priority, reason, note, fromLocationId, toLocationId, requestedByUserId: user.id, requestType, equipmentRef, purpose, issuedTo });
    await triggerNotification("REQUEST_CREATED", requestNotificationContext(request));
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
    const updated = await acceptStockRequest(id, user.id);
    await triggerNotification("REQUEST_ACCEPTED", requestNotificationContext(updated));
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
    const updated = await rejectStockRequest(id, user.id, reason);
    await triggerNotification("REQUEST_REJECTED", requestNotificationContext(updated));
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
    const updated = await assignOperator(id, operatorUserId, user.id);
    await triggerNotification("REQUEST_ASSIGNED", requestNotificationContext(updated));
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
    const updated = await startDelivery(id, user.id);
    await triggerNotification("DELIVERY_STARTED", requestNotificationContext(updated));
    await checkStockThresholds(updated.materialId);
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
    const updated = await markDelivered(id, user.id, deliveryNote);
    await triggerNotification("REQUEST_DELIVERED", requestNotificationContext(updated));
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
    const updated = await confirmReceipt(id, quantity, user.id, note);
    await triggerNotification(updated.status === "COMPLETED" ? "REQUEST_RECEIVED" : "REQUEST_PARTIALLY_RECEIVED", requestNotificationContext(updated));
    await checkStockThresholds(updated.materialId);
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
    const updated = await markNotReceived(id, user.id, reason);
    await triggerNotification("REQUEST_NOT_RECEIVED", requestNotificationContext(updated));
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
    const maxStock = formData.get("maxStock") ? Number(formData.get("maxStock")) : null;
    const defaultLocationId = formData.get("defaultLocationId") ? String(formData.get("defaultLocationId")) : null;
    // Spare Management — meaningful only for category = SPARE, but always read/stored as
    // submitted (null when blank) rather than gated here, so switching a material's category
    // never needs special-case handling.
    const partNumber = formData.get("partNumber") ? String(formData.get("partNumber")) : null;
    const manufacturer = formData.get("manufacturer") ? String(formData.get("manufacturer")) : null;
    const equipmentRef = formData.get("equipmentRef") ? String(formData.get("equipmentRef")) : null;
    const criticality = formData.get("criticality") ? String(formData.get("criticality")) : null;

    if (!materialCode || !name || !category || !uom) return fail("Code, name, category, and UOM are required");
    if (minStock != null && maxStock != null && minStock > maxStock) return fail("Min stock cannot be greater than max stock");

    const data = { materialCode, name, category, uom, minStock, maxStock, defaultLocationId, partNumber, manufacturer, equipmentRef, criticality };
    if (id) {
      // Active status is no longer form-editable — it's only ever changed by the safety-checked
      // actionDeleteMaterial below, so it's deliberately omitted here rather than read from the form.
      await prisma.material.update({ where: { id }, data });
    } else {
      await prisma.material.create({ data: { ...data, active: true } });
    }
    revalidatePath("/materials");
    revalidatePath("/inventory");
    revalidatePath("/");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to save material");
  }
}

/** Delete presented to the user; internally a safety-checked soft delete (active -> false) — a
 *  material with stock on hand can never be removed from view, only deactivated once it's empty. */
export async function actionDeleteMaterial(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, MASTER_DATA_ROLES);
    const id = String(formData.get("id"));
    const balance = await prisma.inventoryBalance.findFirst({ where: { materialId: id, quantity: { gt: 1e-6 } } });
    if (balance) return fail("Cannot delete a material that still holds stock — move or consume its stock first.");
    await prisma.material.update({ where: { id }, data: { active: false } });
    revalidatePath("/materials");
    revalidatePath("/inventory");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to delete material");
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
    const capacityUom = capacity != null && formData.get("capacityUom") ? String(formData.get("capacityUom")) : null;

    if (!name || !type) return fail("Name and type are required");

    if (id) {
      // Active status is no longer form-editable — it's only ever changed by the safety-checked
      // actionDeleteLocation below, so it's deliberately omitted here rather than read from the form.
      await prisma.location.update({ where: { id }, data: { name, type, capacity, capacityUom } });
    } else {
      await prisma.location.create({ data: { name, type, capacity, capacityUom, active: true } });
    }
    revalidatePath("/locations");
    revalidatePath("/materials");
    revalidatePath("/inventory");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to save location");
  }
}

/** Delete presented to the user; internally a safety-checked soft delete (active -> false) — a
 *  location with stock on hand can never be removed from view, only deactivated once it's empty. */
export async function actionDeleteLocation(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, MASTER_DATA_ROLES);
    const id = String(formData.get("id"));
    const balance = await prisma.inventoryBalance.findFirst({ where: { locationId: id, quantity: { gt: 1e-6 } } });
    if (balance) return fail("Cannot delete a location that still holds stock — move or consume its stock first.");
    await prisma.location.update({ where: { id }, data: { active: false } });
    revalidatePath("/locations");
    revalidatePath("/materials");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to delete location");
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

    if (mode !== "draft") await checkStockThresholds(receipt.materialId);
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
    const receipt = await postMaterialReceipt(id, user.id);
    await checkStockThresholds(receipt.materialId);
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

// ---------------------------------------------------------------------------
// Dispatch — finished-goods/customer dispatch, separate from the Request lifecycle above.
// ---------------------------------------------------------------------------

function revalidateDispatchViews() {
  revalidateInventoryViews();
  revalidatePath("/movements");
}

function dispatchNotificationContext(updated: { id: string; materialId: string; quantity: number; dispatchReference: string; createdByUserId: string; assignedToUserId: string | null }) {
  return {
    recordId: updated.id,
    materialId: updated.materialId,
    quantity: updated.quantity,
    reference: updated.dispatchReference,
    createdByUserId: updated.createdByUserId,
    assignedToUserId: updated.assignedToUserId ?? undefined,
    link: `/movements/dispatches/${updated.id}`,
  };
}

export async function actionCreateDispatch(formData: FormData) {
  try {
    const user = await getCurrentUser();
    const materialId = String(formData.get("materialId"));
    const quantity = Number(formData.get("quantity"));
    const sourceLocationId = String(formData.get("sourceLocationId"));
    const customerDestination = String(formData.get("customerDestination") || "");
    if (!materialId || !sourceLocationId || Number.isNaN(quantity) || quantity <= 0 || !customerDestination.trim()) {
      return fail("Missing required fields");
    }
    const dispatch = await createDispatch({
      materialId,
      quantity,
      sourceLocationId,
      customerDestination,
      batchLot: formData.get("batchLot") ? String(formData.get("batchLot")) : undefined,
      weighmentReference: formData.get("weighmentReference") ? String(formData.get("weighmentReference")) : undefined,
      notes: formData.get("notes") ? String(formData.get("notes")) : undefined,
      createdByUserId: user.id,
    });
    await triggerNotification("DISPATCH_CREATED", dispatchNotificationContext(dispatch));
    revalidatePath("/movements");
    return ok({ dispatchId: dispatch.id, dispatchReference: dispatch.dispatchReference });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to create dispatch");
  }
}

export async function actionApproveDispatch(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const operatorUserId = String(formData.get("operatorUserId"));
    if (!id || !operatorUserId) return fail("Choose an operator to assign");
    const user = await getCurrentUser();
    const updated = await approveDispatch(id, operatorUserId, user.id);
    await triggerNotification("DISPATCH_APPROVED", dispatchNotificationContext(updated));
    revalidateDispatchViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to approve dispatch");
  }
}

export async function actionReassignDispatchOperator(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const operatorUserId = String(formData.get("operatorUserId"));
    if (!id || !operatorUserId) return fail("Choose an operator to reassign to");
    const user = await getCurrentUser();
    await reassignDispatchOperator(id, operatorUserId, user.id);
    revalidatePath("/movements");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to reassign dispatch");
  }
}

export async function actionStartDispatchLoading(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const user = await getCurrentUser();
    await startDispatchLoading(id, user.id);
    revalidateDispatchViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to start loading");
  }
}

export async function actionMarkDispatched(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const user = await getCurrentUser();
    const updated = await markDispatched(id, user.id);
    await triggerNotification("DISPATCH_DISPATCHED", dispatchNotificationContext(updated));
    await checkStockThresholds(updated.materialId);
    revalidateDispatchViews();
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to mark dispatched");
  }
}

export async function actionCancelDispatch(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const reason = String(formData.get("reason") || "");
    if (!reason.trim()) return fail("A reason is required to cancel a dispatch");
    const user = await getCurrentUser();
    const updated = await cancelDispatch(id, user.id, reason);
    await triggerNotification("DISPATCH_CANCELLED", dispatchNotificationContext(updated));
    revalidatePath("/movements");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to cancel dispatch");
  }
}

// ---------------------------------------------------------------------------
// Notifications — notification centre (read/unread) + rule configuration
// ---------------------------------------------------------------------------

export async function actionMarkNotificationRead(formData: FormData) {
  try {
    const id = String(formData.get("id"));
    const user = await getCurrentUser();
    // Scoped to the caller's own notifications in the `where` — not just a hidden UI check.
    await prisma.notification.updateMany({ where: { id, recipientUserId: user.id }, data: { read: true, readAt: new Date() } });
    revalidatePath("/notifications");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to mark notification read");
  }
}

export async function actionMarkAllNotificationsRead() {
  try {
    const user = await getCurrentUser();
    await prisma.notification.updateMany({ where: { recipientUserId: user.id, read: false }, data: { read: true, readAt: new Date() } });
    revalidatePath("/notifications");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to mark all notifications read");
  }
}

function ruleInputFromForm(formData: FormData) {
  const event = String(formData.get("event") || "") as NotificationEvent;
  const recipientType = String(formData.get("recipientType") || "");
  const recipientRole = formData.get("recipientRole") ? String(formData.get("recipientRole")) : null;
  const recipientUserId = formData.get("recipientUserId") ? String(formData.get("recipientUserId")) : null;
  const channel = String(formData.get("channel") || "");
  const notificationType = String(formData.get("notificationType") || "");
  const title = String(formData.get("title") || "").trim();
  const message = String(formData.get("message") || "").trim();
  return { event, recipientType, recipientRole, recipientUserId, channel, notificationType, title, message };
}

export async function actionCreateNotificationRule(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, NOTIFICATION_CONFIG_ROLES);
    const input = ruleInputFromForm(formData);
    if (!input.event || !input.recipientType || !input.channel || !input.notificationType || !input.title || !input.message) return fail("Missing required fields");
    if (input.recipientType === "ROLE" && !input.recipientRole) return fail("Choose a role");
    if (input.recipientType === "SPECIFIC_USER" && !input.recipientUserId) return fail("Choose a user");
    await prisma.notificationRule.create({ data: { ...input, status: "ENABLED" } });
    revalidatePath("/notifications");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to create rule");
  }
}

export async function actionUpdateNotificationRule(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, NOTIFICATION_CONFIG_ROLES);
    const id = String(formData.get("id"));
    const input = ruleInputFromForm(formData);
    if (!id || !input.event || !input.recipientType || !input.channel || !input.notificationType || !input.title || !input.message) return fail("Missing required fields");
    if (input.recipientType === "ROLE" && !input.recipientRole) return fail("Choose a role");
    if (input.recipientType === "SPECIFIC_USER" && !input.recipientUserId) return fail("Choose a user");
    await prisma.notificationRule.update({ where: { id }, data: input });
    revalidatePath("/notifications");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update rule");
  }
}

export async function actionToggleNotificationRule(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, NOTIFICATION_CONFIG_ROLES);
    const id = String(formData.get("id"));
    const status = String(formData.get("status")) as "ENABLED" | "DISABLED";
    await prisma.notificationRule.update({ where: { id }, data: { status } });
    revalidatePath("/notifications");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update rule status");
  }
}

export async function actionDeleteNotificationRule(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, NOTIFICATION_CONFIG_ROLES);
    const id = String(formData.get("id"));
    await prisma.notificationRule.delete({ where: { id } });
    revalidatePath("/notifications");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to delete rule");
  }
}

// ---------------------------------------------------------------------------
// Report Scheduling — a persisted delivery preference for an existing /reports tab, not a
// real cron job (no background job runner in this sandboxed app). "Run Now" is the only way
// a schedule is ever executed. Same CRUD shape as Notification Rules above, reusing the same
// NOTIFICATION_CONFIG_ROLES gate (report scheduling is master-data-adjacent configuration,
// no new role).
// ---------------------------------------------------------------------------

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function scheduleInputFromForm(formData: FormData) {
  const reportType = String(formData.get("reportType") || "");
  const frequency = String(formData.get("frequency") || "");
  const timeOfDay = String(formData.get("timeOfDay") || "");
  const dayOfWeek = frequency === "WEEKLY" && formData.get("dayOfWeek") ? String(formData.get("dayOfWeek")) : null;
  const dayOfMonth = frequency === "MONTHLY" && formData.get("dayOfMonth") ? Number(formData.get("dayOfMonth")) : null;
  const recipientType = String(formData.get("recipientType") || "");
  const recipientRole = formData.get("recipientRole") ? String(formData.get("recipientRole")) : null;
  const recipientUserId = formData.get("recipientUserId") ? String(formData.get("recipientUserId")) : null;
  return { reportType, frequency, timeOfDay, dayOfWeek, dayOfMonth, recipientType, recipientRole, recipientUserId };
}

function validateScheduleInput(input: ReturnType<typeof scheduleInputFromForm>) {
  if (!input.reportType || !input.frequency || !input.timeOfDay || !input.recipientType) return "Missing required fields";
  if (!(REPORT_TYPES as readonly string[]).includes(input.reportType)) return "Invalid report type";
  if (!(REPORT_SCHEDULE_FREQUENCIES as readonly string[]).includes(input.frequency)) return "Invalid frequency";
  if (!TIME_OF_DAY_RE.test(input.timeOfDay)) return "Time must be in HH:mm format";
  if (input.frequency === "WEEKLY" && !input.dayOfWeek) return "Choose a day of the week";
  if (input.frequency === "WEEKLY" && input.dayOfWeek && !(DAYS_OF_WEEK as readonly string[]).includes(input.dayOfWeek)) return "Invalid day of week";
  if (input.frequency === "MONTHLY" && (!input.dayOfMonth || input.dayOfMonth < 1 || input.dayOfMonth > 31)) return "Choose a day of the month (1-31)";
  if (!(REPORT_SCHEDULE_RECIPIENT_TYPES as readonly string[]).includes(input.recipientType)) return "Invalid recipient type";
  if (input.recipientType === "ROLE" && !input.recipientRole) return "Choose a role";
  if (input.recipientType === "SPECIFIC_USER" && !input.recipientUserId) return "Choose a user";
  return null;
}

export async function actionCreateReportSchedule(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, NOTIFICATION_CONFIG_ROLES);
    const input = scheduleInputFromForm(formData);
    const error = validateScheduleInput(input);
    if (error) return fail(error);
    await prisma.reportSchedule.create({ data: { ...input, status: "ENABLED" } });
    revalidatePath("/reports");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to create schedule");
  }
}

export async function actionUpdateReportSchedule(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, NOTIFICATION_CONFIG_ROLES);
    const id = String(formData.get("id"));
    const input = scheduleInputFromForm(formData);
    const error = !id ? "Missing required fields" : validateScheduleInput(input);
    if (error) return fail(error);
    await prisma.reportSchedule.update({ where: { id }, data: input });
    revalidatePath("/reports");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update schedule");
  }
}

export async function actionToggleReportSchedule(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, NOTIFICATION_CONFIG_ROLES);
    const id = String(formData.get("id"));
    const status = String(formData.get("status")) as "ENABLED" | "DISABLED";
    await prisma.reportSchedule.update({ where: { id }, data: { status } });
    revalidatePath("/reports");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update schedule status");
  }
}

export async function actionDeleteReportSchedule(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, NOTIFICATION_CONFIG_ROLES);
    const id = String(formData.get("id"));
    await prisma.reportSchedule.delete({ where: { id } });
    revalidatePath("/reports");
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to delete schedule");
  }
}

// Simulated delivery — resolves recipients the same two ways a schedule can name them (Role
// or Specific User; RELEVANT_USER has no analog here, see enums.ts), sends one simulated email
// per recipient via the same transport notifications use, and logs one ReportScheduleRun row
// summarizing the batch. No real report data/attachment is generated — a link back to the
// report tab, same as how notification emails only ever carry a link, not embedded data.
export async function actionRunReportSchedule(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, NOTIFICATION_CONFIG_ROLES);
    const id = String(formData.get("id"));
    const schedule = await prisma.reportSchedule.findUniqueOrThrow({ where: { id } });

    const recipients =
      schedule.recipientType === "ROLE"
        ? await prisma.user.findMany({ where: { role: schedule.recipientRole ?? undefined, active: true } })
        : schedule.recipientUserId
          ? await prisma.user.findMany({ where: { id: schedule.recipientUserId, active: true } })
          : [];

    const reportLabel = REPORT_TYPE_LABELS[schedule.reportType as keyof typeof REPORT_TYPE_LABELS] ?? schedule.reportType;
    const subject = `${reportLabel} Report`;
    const body = `Your scheduled ${reportLabel} report is ready. View it at /reports?tab=${schedule.reportType}`;
    let anyFailed = false;
    for (const recipient of recipients) {
      if (!recipient.email) {
        anyFailed = true;
        continue;
      }
      const result = await sendEmail({ to: recipient.email, subject, body });
      if (result.status !== "SENT") anyFailed = true;
    }

    await prisma.reportScheduleRun.create({
      data: { scheduleId: schedule.id, recipientCount: recipients.length, emailStatus: anyFailed ? "FAILED" : "SENT" },
    });
    revalidatePath("/reports");
    return ok({ recipientCount: recipients.length });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to run schedule");
  }
}

// ---------------------------------------------------------------------------
// Spare Management — a spare return posts through the existing ledger/quality mechanisms
// (src/lib/inventory/spareReturn.ts). Same STOCK_OPS_ROLES gate as every other recording action.
// ---------------------------------------------------------------------------

export async function actionPostSpareReturn(formData: FormData) {
  try {
    const user = await getCurrentUser();
    requireRole(user, STOCK_OPS_ROLES);
    const requestId = String(formData.get("requestId") || "");
    const materialId = String(formData.get("materialId"));
    const locationId = String(formData.get("locationId"));
    const quantity = Number(formData.get("quantity"));
    const condition = String(formData.get("condition")) as ReturnCondition;
    const returnedBy = String(formData.get("returnedBy") || "");
    const reason = formData.get("reason") ? String(formData.get("reason")) : undefined;
    const remarks = formData.get("remarks") ? String(formData.get("remarks")) : undefined;
    if (!requestId || !materialId || !locationId || Number.isNaN(quantity) || quantity <= 0 || !condition || !returnedBy.trim()) {
      return fail("Missing required fields");
    }

    const material = await prisma.material.findUniqueOrThrow({ where: { id: materialId } });
    if (material.category !== "SPARE") return fail(`${material.name} is not a spare`);
    if (!material.active) return fail(`${material.name} is not active`);

    const spareReturn = await postSpareReturn({ requestId, materialId, locationId, quantity, condition, returnedBy, reason, remarks, userId: user.id });
    await checkStockThresholds(materialId);
    revalidateInventoryViews();
    revalidatePath("/movements");
    return ok({ returnReference: spareReturn.returnReference });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to record spare return");
  }
}

// ---------------------------------------------------------------------------
// Bruce AI — read-only advisory Q&A over existing data. No revalidatePath: nothing is written.
// ---------------------------------------------------------------------------

export async function actionAskBruce(formData: FormData) {
  try {
    const question = String(formData.get("question") || "").trim();
    if (!question) return fail("Ask Bruce AI a question first");
    const user = await getCurrentUser();
    const answer = await answerBruceQuestion(question, { id: user.id, role: user.role });
    return ok({ text: answer.text, links: answer.links ?? [] });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Bruce AI is temporarily unavailable");
  }
}
