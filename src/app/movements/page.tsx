import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { Panel } from "@/components/ui";
import { getCurrentUser, restrictToRequestsOnly } from "@/lib/auth";
import {
  STOCK_OPS_ROLES,
  ADJUSTMENT_ROLES,
  DISPATCH_CREATE_ROLES,
  DISPATCH_APPROVE_ROLES,
  DISPATCH_EXECUTE_ROLES,
  DISPATCH_CANCEL_ROLES,
  DEFAULT_TOLERANCE_PCT,
  IN_TRANSIT_LOCATION_TYPE,
  type UserRole,
} from "@/lib/domain/enums";
import { MovementTabs } from "./movement-tabs";

export const dynamic = "force-dynamic";

// Each Stock Operations tab shows only the history for its own transaction type — no
// shared/mixed movement list across tabs (Receive Material's GRN list and Dispatch's list
// were already tab-scoped; Consume/Transfer/Adjustment now get the same treatment).
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
  // receive/consume/transfer/count against; it only exists to model a request's delivery.
  const [materials, locations, balances, qualityBalances, consumptionMovements, transferMovements, adjustmentMovements, receipts, suppliers, currentUser] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
    prisma.inventoryBalance.findMany({ where: { quantity: { gt: 1e-6 }, location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } }, include: { material: true, location: true } }),
    // Batched, avoids an N+1 getUnrestrictedAvailable() call per (material, location) row —
    // same pattern already used in inventory/page.tsx and dashboard.ts.
    prisma.qualityBalance.findMany({}),
    recentByType("CONSUMPTION"),
    recentByType("TRANSFER"),
    recentByType("ADJUSTMENT"),
    prisma.materialReceipt.findMany({ include: { supplier: true, material: true }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    getCurrentUser(),
  ]);
  restrictToRequestsOnly(currentUser);
  // Store Supervisor is intentionally NOT redirected away from this page anymore — it needs to
  // reach the Dispatch tab (see DISPATCH_* role constants below). MovementTabs still hides the
  // Receive Material/Consume/Transfer/Adjustment tabs from anyone canRecord doesn't cover.
  const canRecord = STOCK_OPS_ROLES.includes(currentUser.role as UserRole);
  const canApprove = ADJUSTMENT_ROLES.includes(currentUser.role as UserRole);
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

  // Only counts that actually have a variance and haven't been posted yet — a count that
  // matched book stock exactly also has no adjustmentTransactionId (there was nothing to
  // adjust), so that alone isn't "pending," it's just done.
  const pendingCounts = canApprove
    ? (
        await prisma.physicalCount.findMany({
          where: { adjustmentTransactionId: null },
          include: { material: true, location: true },
          orderBy: { countedAt: "desc" },
        })
      ).filter((c) => Math.abs(c.countedQuantity - c.bookQuantityAtCount) > 1e-6)
    : [];

  function movementRows(rows: typeof consumptionMovements) {
    return rows.map((m) => ({
      id: m.id,
      timestamp: m.timestamp,
      materialName: m.material.name,
      uom: m.uom,
      quantity: m.quantity,
      fromLocationName: m.sourceLocation?.name ?? null,
      toLocationName: m.destinationLocation?.name ?? null,
      reference: m.reference ?? m.reason ?? null,
    }));
  }
  const consumptionRows = movementRows(consumptionMovements);
  const transferRows = movementRows(transferMovements);
  const adjustmentRows = movementRows(adjustmentMovements);

  const receiptRows = receipts.map((r) => ({
    id: r.id,
    grnNumber: r.grnNumber,
    receiptDate: r.receiptDate,
    supplierName: r.supplier.name,
    materialName: r.material.name,
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
    uom: d.material.uom,
    quantity: d.quantity,
    sourceLocationId: d.sourceLocationId,
    sourceLocationName: d.sourceLocation.name,
    customerDestination: d.customerDestination,
    status: d.status,
    assignedToName: d.assignedTo?.name ?? null,
    createdAt: d.createdAt,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Stock Operations</h1>
        <p className="mt-1 text-sm text-muted">Receive Material, Consume Stock, Transfer Stock, and Adjustment. Every action here creates a persisted ledger entry and updates inventory immediately.</p>
      </div>

      <Panel>
        {canRecord || canAccessDispatch ? (
          <Suspense>
            <MovementTabs
              materials={materials.map((m) => ({ id: m.id, name: m.name, uom: m.uom }))}
              locations={locations.map((l) => ({ id: l.id, name: l.name }))}
              balances={balanceRows}
              receipts={receiptRows}
              suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
              canRecord={canRecord}
              dispatches={dispatchRows}
              canCreateDispatch={DISPATCH_CREATE_ROLES.includes(role)}
              canAccessDispatch={canAccessDispatch}
              consumptionMovements={consumptionRows}
              transferMovements={transferRows}
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
            />
          </Suspense>
        ) : (
          <p className="text-sm text-muted-soft">
            Your role ({currentUser.role}) cannot record stock operations — this requires Store/Delivery Operator, Inventory Manager, or Admin.
          </p>
        )}
      </Panel>
    </div>
  );
}
