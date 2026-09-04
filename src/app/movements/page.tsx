import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { Panel } from "@/components/ui";
import { getCurrentUser, restrictToRequestsOnly } from "@/lib/auth";
import {
  STOCK_OPS_ROLES,
  PHYSICAL_COUNT_ROLES,
  ADJUSTMENT_ROLES,
  SPARE_RETURN_COMPLETE_ROLES,
  SPARE_RETURN_VIEW_ROLES,
  DISPATCH_CREATE_ROLES,
  DISPATCH_APPROVE_ROLES,
  DISPATCH_EXECUTE_ROLES,
  DISPATCH_CANCEL_ROLES,
  DEFAULT_TOLERANCE_PCT,
  IN_TRANSIT_LOCATION_TYPE,
  ROLE_LABELS,
  type UserRole,
} from "@/lib/domain/enums";
import { MovementTabs } from "./movement-tabs";

export const dynamic = "force-dynamic";

// Each Stock Operations tab shows only the history for its own transaction type — no
// shared/mixed movement list across tabs (Receive Material's GRN list and Dispatch's list
// are tab-scoped; Adjustment gets the same treatment).
function recentByType(transactionType: string) {
  return prisma.inventoryTransaction.findMany({
    where: { transactionType },
    include: { material: true, sourceLocation: true, destinationLocation: true },
    orderBy: { timestamp: "desc" },
    take: 15,
  });
}

export default async function StockOperationsPage() {
  // Every query here excludes the virtual in-transit location — it's not a real place to
  // receive/count against; it only exists to model a request's delivery.
  const [materials, spareMaterials, locations, balances, qualityBalances, adjustmentMovements, receipts, suppliers, currentUser] = await Promise.all([
    // Includes spares — Receive/Adjustment/Dispatch are generic to any material.
    // spareMaterials below is the SPARE-only subset the Spare Return tab needs.
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.material.findMany({ where: { active: true, category: "SPARE" }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
    prisma.inventoryBalance.findMany({ where: { quantity: { gt: 1e-6 }, location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } }, include: { material: true, location: true } }),
    // Batched, avoids an N+1 getUnrestrictedAvailable() call per (material, location) row —
    // same pattern already used in inventory/page.tsx and dashboard.ts.
    prisma.qualityBalance.findMany({}),
    recentByType("ADJUSTMENT"),
    prisma.materialReceipt.findMany({ include: { supplier: true, material: true }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    getCurrentUser(),
  ]);
  restrictToRequestsOnly(currentUser);
  // Store Supervisor is intentionally NOT redirected away from this page anymore — it needs to
  // reach the Dispatch tab (see DISPATCH_* role constants below), and now the Adjustment tab's
  // physical-count step too (see canRecordAdjustment). MovementTabs still hides Receive
  // Material from anyone canRecord doesn't cover.
  const canRecord = STOCK_OPS_ROLES.includes(currentUser.role as UserRole);
  // Adjustment workflow: who can record a physical count / submit a discrepancy for review —
  // broader than canRecord (adds Store Supervisor). Who can approve/reject/post one stays
  // canApprove (ADJUSTMENT_ROLES = Inventory Manager/Admin only), unchanged.
  const canRecordAdjustment = PHYSICAL_COUNT_ROLES.includes(currentUser.role as UserRole);
  const canApprove = ADJUSTMENT_ROLES.includes(currentUser.role as UserRole);
  // Spare Return: who can complete a reported return (post it to inventory) vs. who can only
  // view/monitor the tab — Inventory Manager/Store Supervisor get view-only per spec.
  const canCompleteSpareReturn = SPARE_RETURN_COMPLETE_ROLES.includes(currentUser.role as UserRole);
  const canViewSpareReturns = SPARE_RETURN_VIEW_ROLES.includes(currentUser.role as UserRole);
  const role = currentUser.role as UserRole;
  const canAccessDispatch =
    DISPATCH_CREATE_ROLES.includes(role) || DISPATCH_APPROVE_ROLES.includes(role) || DISPATCH_EXECUTE_ROLES.includes(role) || DISPATCH_CANCEL_ROLES.includes(role);

  const nonUnrestrictedByKey = new Map<string, number>();
  for (const q of qualityBalances) {
    const key = `${q.materialId}:${q.locationId}`;
    nonUnrestrictedByKey.set(key, (nonUnrestrictedByKey.get(key) ?? 0) + q.quantity);
  }
  const balanceRows = balances.map((b) => ({
    materialId: b.materialId,
    materialName: b.material.name,
    uom: b.material.uom,
    locationId: b.locationId,
    locationName: b.location.name,
    quantity: b.quantity,
    unrestrictedQuantity: Math.max(0, b.quantity - (nonUnrestrictedByKey.get(`${b.materialId}:${b.locationId}`) ?? 0)),
    tolerancePct: b.material.tolerancePct ?? DEFAULT_TOLERANCE_PCT,
  }));

  // Only counts that actually have a variance and haven't been posted or rejected yet — a
  // count that matched book stock exactly also has no adjustmentTransactionId (there was
  // nothing to adjust), so that alone isn't "pending," it's just done. Visible to anyone who
  // can record a count (Store Operator/Supervisor "review", per spec) — but only canApprove
  // renders the Approve/Reject controls; everyone else sees it read-only.
  const pendingCounts = canApprove || canRecordAdjustment
    ? (
        await prisma.physicalCount.findMany({
          where: { adjustmentTransactionId: null, rejectedAt: null },
          include: { material: true, location: true },
          orderBy: { countedAt: "desc" },
        })
      ).filter((c) => Math.abs(c.countedQuantity - c.bookQuantityAtCount) > 1e-6)
    : [];

  function movementRows(rows: typeof adjustmentMovements) {
    return rows.map((m) => ({
      id: m.id,
      timestamp: m.timestamp,
      materialName: m.material.name,
      category: m.material.category,
      uom: m.uom,
      quantity: m.quantity,
      fromLocationName: m.sourceLocation?.name ?? null,
      toLocationName: m.destinationLocation?.name ?? null,
      reference: m.reference ?? m.reason ?? null,
    }));
  }
  const adjustmentRows = movementRows(adjustmentMovements);

  const receiptRows = receipts.map((r) => ({
    id: r.id,
    grnNumber: r.grnNumber,
    receiptDate: r.receiptDate,
    supplierName: r.supplier.name,
    materialName: r.material.name,
    category: r.material.category,
    receivedQuantity: r.receivedQuantity,
    acceptedQuantity: r.acceptedQuantity,
    rejectedQuantity: r.rejectedQuantity,
    status: r.status,
  }));

  // Store Operator's view is scoped to only what's assigned to them (per the Dispatch spec's own
  // RBAC — "View assigned Dispatches only"); every other role with Dispatch access sees all.
  const dispatches = canAccessDispatch
    ? await prisma.dispatch.findMany({
        where: role === "STORE_OPERATOR" ? { assignedToUserId: currentUser.id } : {},
        include: { material: true, sourceLocation: true, assignedTo: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const dispatchRows = dispatches.map((d) => ({
    id: d.id,
    dispatchReference: d.dispatchReference,
    materialId: d.materialId,
    materialName: d.material.name,
    category: d.material.category,
    uom: d.material.uom,
    quantity: d.quantity,
    sourceLocationId: d.sourceLocationId,
    sourceLocationName: d.sourceLocation.name,
    customerDestination: d.customerDestination,
    status: d.status,
    assignedToName: d.assignedTo?.name ?? null,
    createdAt: d.createdAt,
  }));

  // Spare Return tab: only requests that are actually spare ISSUES with something outstanding
  // to return (requestType=SPARE, purpose=ISSUE, deliveredQuantity>0) — the prior version of
  // this query offered every SPARE-type request regardless of purpose/whether anything had
  // ever been issued. "Already returned" is now a real FK aggregate against SpareReturn.requestId,
  // not a string match on InventoryTransaction.reference/reason.
  const spareRequests = canViewSpareReturns
    ? await prisma.stockRequest.findMany({
        where: { requestType: "SPARE", purpose: "ISSUE", deliveredQuantity: { gt: 0 } },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];
  const returnedByRequestId = new Map<string, number>();
  if (spareRequests.length > 0) {
    const returnRows = await prisma.spareReturn.groupBy({
      by: ["requestId"],
      where: { requestId: { in: spareRequests.map((r) => r.id) } },
      _sum: { quantity: true },
    });
    for (const r of returnRows) returnedByRequestId.set(r.requestId, r._sum.quantity ?? 0);
  }
  const spareRequestOptions = spareRequests.map((r) => ({
    id: r.id,
    requestNumber: r.requestNumber,
    materialId: r.materialId,
    issued: r.deliveredQuantity,
    alreadyReturned: returnedByRequestId.get(r.id) ?? 0,
  }));

  // Spare Return List: the persisted SpareReturn records themselves, most recent first —
  // REPORTED (awaiting a Store Operator to complete) and COMPLETED both included; the panel
  // itself splits them into a "Pending" section and a "History" table.
  const spareReturns = canViewSpareReturns
    ? await prisma.spareReturn.findMany({
        include: { material: true, location: true, processedBy: true, reportedBy: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];
  const spareReturnRows = spareReturns.map((sr) => ({
    id: sr.id,
    returnReference: sr.returnReference,
    originalIssueReference: sr.originalIssueReference,
    materialId: sr.materialId,
    materialName: sr.material.name,
    uom: sr.material.uom,
    quantity: sr.quantity,
    status: sr.status,
    returnedBy: sr.returnedBy,
    reportedByName: sr.reportedBy?.name ?? "—",
    reason: sr.reason,
    condition: sr.condition,
    locationName: sr.location?.name ?? null,
    processedByName: sr.processedBy?.name ?? null,
    createdAt: sr.createdAt,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Stock Operations</h1>
      </div>

      <Panel>
        {canRecord || canAccessDispatch || canRecordAdjustment || canViewSpareReturns ? (
          <Suspense>
            <MovementTabs
              materials={materials.map((m) => ({ id: m.id, name: m.name, uom: m.uom }))}
              locations={locations.map((l) => ({ id: l.id, name: l.name }))}
              balances={balanceRows}
              receipts={receiptRows}
              suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
              canRecord={canRecord}
              canRecordAdjustment={canRecordAdjustment}
              canCompleteSpareReturn={canCompleteSpareReturn}
              canViewSpareReturns={canViewSpareReturns}
              dispatches={dispatchRows}
              canCreateDispatch={DISPATCH_CREATE_ROLES.includes(role)}
              canAccessDispatch={canAccessDispatch}
              adjustmentMovements={adjustmentRows}
              pendingCounts={pendingCounts.map((c) => ({
                id: c.id,
                materialName: c.material.name,
                uom: c.material.uom,
                locationName: c.location.name,
                bookQuantity: c.bookQuantityAtCount,
                countedQuantity: c.countedQuantity,
                tolerancePct: c.material.tolerancePct ?? DEFAULT_TOLERANCE_PCT,
                countedBy: c.countedBy,
                note: c.note,
              }))}
              canApprove={canApprove}
              spareMaterials={spareMaterials.map((m) => ({ id: m.id, name: m.name, uom: m.uom }))}
              spareRequests={spareRequestOptions}
              spareReturns={spareReturnRows}
            />
          </Suspense>
        ) : (
          <p className="text-sm text-muted-soft">
            Your role ({ROLE_LABELS[currentUser.role as UserRole]}) cannot record stock operations — this requires Store/Delivery Operator, Inventory Manager, or Admin.
          </p>
        )}
      </Panel>
    </div>
  );
}
