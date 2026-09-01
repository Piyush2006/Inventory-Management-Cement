import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { Panel, Th, Td, EmptyState } from "@/components/ui";
import { formatNumber, formatDateTime } from "@/lib/format";
import { getCurrentUser, restrictToRequestsOnly, restrictStockOperationsFromSupervisor } from "@/lib/auth";
import { STOCK_OPS_ROLES, ADJUSTMENT_ROLES, DEFAULT_TOLERANCE_PCT, IN_TRANSIT_LOCATION_TYPE, type UserRole } from "@/lib/domain/enums";
import { MovementTabs } from "./movement-tabs";
import { PendingCountsPanel } from "./pending-counts-panel";

export const dynamic = "force-dynamic";

export default async function StockOperationsPage() {
  // Every query here excludes the virtual in-transit location — it's not a real place to
  // receive/consume/transfer/count against; it only exists to model a request's delivery.
  const [materials, locations, balances, recentMovements, receipts, suppliers, currentUser] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
    prisma.inventoryBalance.findMany({ where: { quantity: { gt: 1e-6 }, location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } }, include: { material: true, location: true } }),
    prisma.inventoryTransaction.findMany({
      include: { material: true, sourceLocation: true, destinationLocation: true },
      orderBy: { timestamp: "desc" },
      take: 15,
    }),
    prisma.materialReceipt.findMany({ include: { supplier: true, material: true }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    getCurrentUser(),
  ]);
  restrictToRequestsOnly(currentUser);
  restrictStockOperationsFromSupervisor(currentUser);
  const canRecord = STOCK_OPS_ROLES.includes(currentUser.role as UserRole);
  const canApprove = ADJUSTMENT_ROLES.includes(currentUser.role as UserRole);

  const balanceRows = balances.map((b) => ({
    materialId: b.materialId,
    materialName: b.material.name,
    uom: b.material.uom,
    locationId: b.locationId,
    locationName: b.location.name,
    quantity: b.quantity,
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Stock Operations</h1>
        <p className="mt-1 text-sm text-muted">Receive Material, Consume Stock, Transfer Stock, and Adjustment. Every action here creates a persisted ledger entry and updates inventory immediately.</p>
      </div>

      <Panel>
        {canRecord ? (
          <Suspense>
            <MovementTabs
              materials={materials.map((m) => ({ id: m.id, name: m.name, uom: m.uom }))}
              locations={locations.map((l) => ({ id: l.id, name: l.name }))}
              balances={balanceRows}
              receipts={receiptRows}
              suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
              canRecord={canRecord}
            />
          </Suspense>
        ) : (
          <p className="text-sm text-muted-soft">
            Your role ({currentUser.role}) cannot record stock operations — this requires Store/Delivery Operator, Inventory Manager, or Admin.
          </p>
        )}
      </Panel>

      {canApprove && pendingCounts.length > 0 && (
        <Panel title={`Pending Physical Counts (${pendingCounts.length})`}>
          <PendingCountsPanel
            counts={pendingCounts.map((c) => ({
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
          />
        </Panel>
      )}

      <Panel title="Recent Movements">
        {recentMovements.length === 0 ? (
          <EmptyState title="No movements recorded yet" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Timestamp</Th>
                  <Th>Type</Th>
                  <Th>Material</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th>Reference / Reason</Th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.map((m) => (
                  <tr key={m.id} className="border-b border-border-soft last:border-0">
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(m.timestamp)}</Td>
                    <Td className="text-xs text-muted">{m.transactionType.replace("_", " ")}</Td>
                    <Td>{m.material.name}</Td>
                    <Td className="text-right tabular">{formatNumber(m.quantity)} {m.uom}</Td>
                    <Td className="text-xs text-muted">{m.sourceLocation?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted">{m.destinationLocation?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted-soft">{m.reference ?? m.reason ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
