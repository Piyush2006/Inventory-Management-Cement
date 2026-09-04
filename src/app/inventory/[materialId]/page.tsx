import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getTotalOnHand, getLocationBalances, getTotalReserved, getTotalInTransit } from "@/lib/inventory/balance";
import { getTotalUnrestrictedAvailable, getTotalQualityBalances } from "@/lib/inventory/quality";
import { classifyStockStatus } from "@/lib/inventory/status";
import { computeDaysOfCover } from "@/lib/inventory/daysOfCover";
import { Panel, KpiTile, Th, Td, EmptyState, LinkPill } from "@/components/ui";
import { StatusBadge, RequestStatusBadge } from "@/components/status-badge";
import { QualityPanel } from "./quality-panel";
import { formatNumber, formatDateTime, formatDate } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";
import { ADJUSTMENT_ROLES, type UserRole } from "@/lib/domain/enums";

export const dynamic = "force-dynamic";

// No restrictToRequestsOnly gate — Indentor (Requester) has full read access. The "Stock
// Operations" pill below is hidden for them specifically since /movements stays write-gated
// (not part of this role's expanded read access) — no dead-end link.
export default async function MaterialDetailPage({ params }: { params: Promise<{ materialId: string }> }) {
  const currentUser = await getCurrentUser();
  const canManageQuality = ADJUSTMENT_ROLES.includes(currentUser.role as UserRole);
  const canReachStockOperations = currentUser.role !== "REQUESTER";
  const { materialId } = await params;
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) notFound();

  const [currentStock, reserved, inTransit, unrestrictedStock, qualityTotals, locations, qualityRows, doc, consumptionHistory, movements, openRequests] = await Promise.all([
    getTotalOnHand(materialId),
    getTotalReserved(materialId),
    getTotalInTransit(materialId),
    getTotalUnrestrictedAvailable(materialId),
    getTotalQualityBalances(materialId),
    getLocationBalances(materialId),
    prisma.qualityBalance.findMany({ where: { materialId } }),
    computeDaysOfCover(materialId),
    prisma.inventoryTransaction.findMany({
      where: { materialId, transactionType: "CONSUMPTION" },
      include: { sourceLocation: true },
      orderBy: { timestamp: "desc" },
      take: 10,
    }),
    prisma.inventoryTransaction.findMany({
      where: { materialId },
      include: { sourceLocation: true, destinationLocation: true },
      orderBy: { timestamp: "desc" },
      take: 20,
    }),
    prisma.stockRequest.findMany({ where: { materialId, status: { in: ["NEW_REQUEST", "ACCEPTED", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "NOT_RECEIVED", "PARTIALLY_RECEIVED"] } }, orderBy: { requiredByDate: "asc" } }),
  ]);

  const { status, reason } = classifyStockStatus({ currentStock: unrestrictedStock, minStock: material.minStock, safetyStock: material.safetyStock });

  const qualityByLocation = new Map<string, { qcHold: number; blocked: number }>();
  for (const q of qualityRows) {
    const entry = qualityByLocation.get(q.locationId) ?? { qcHold: 0, blocked: 0 };
    if (q.status === "QC_HOLD") entry.qcHold = q.quantity;
    if (q.status === "BLOCKED") entry.blocked = q.quantity;
    qualityByLocation.set(q.locationId, entry);
  }
  const locationQuality = locations.map((b) => {
    const q = qualityByLocation.get(b.locationId) ?? { qcHold: 0, blocked: 0 };
    return { locationId: b.locationId, locationName: b.location.name, onHand: b.quantity, unrestricted: Math.max(0, b.quantity - q.qcHold - q.blocked), qcHold: q.qcHold, blocked: q.blocked };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{material.name}</h1>
          <p className="mt-1 text-xs text-muted-soft">
            {material.materialCode} &middot; {material.category.replace("_", " ")}
          </p>
        </div>
        <div className="flex gap-2">
          {canReachStockOperations && <LinkPill href={`/movements?materialId=${material.id}`}>Stock Operations</LinkPill>}
          <LinkPill href={`/requests?materialId=${material.id}`}>Request Stock</LinkPill>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Current Stock" value={`${formatNumber(currentStock)} ${material.uom}`} />
        <KpiTile label="Min Stock" value={material.minStock != null ? formatNumber(material.minStock) : "—"} />
        <KpiTile label="Safety Stock" value={material.safetyStock != null ? formatNumber(material.safetyStock) : "—"} />
        <KpiTile label="Days of Cover" value={doc.na ? "N/A" : `${doc.daysCover?.toFixed(1)}d`} sublabel={doc.na ? "No consumption in 30 days" : `${formatNumber(doc.dailyConsumption)} ${material.uom}/day avg`} />
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Status</span>
        <StatusBadge status={status} />
        <span className="text-xs text-muted">{reason}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="On Hand" value={`${formatNumber(currentStock)} ${material.uom}`} sublabel="Physically at a real location" />
        <KpiTile label="Reserved" value={`${formatNumber(reserved)} ${material.uom}`} sublabel="Assigned, not yet moved" />
        <KpiTile label="Available" value={`${formatNumber(currentStock - reserved)} ${material.uom}`} sublabel="On Hand − Reserved" />
        <KpiTile label="In Transit" value={`${formatNumber(inTransit)} ${material.uom}`} sublabel="Out for delivery, unconfirmed" tone={inTransit > 0 ? "warning" : "default"} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="On Hand" value={`${formatNumber(currentStock)} ${material.uom}`} sublabel="Physically at a real location" />
        <KpiTile label="Unrestricted" value={`${formatNumber(unrestrictedStock)} ${material.uom}`} sublabel="Usable — excludes QC Hold/Blocked" tone={unrestrictedStock < currentStock - 1e-6 ? "warning" : "default"} />
        <KpiTile label="QC Hold" value={`${formatNumber(qualityTotals.qcHold)} ${material.uom}`} sublabel="Pending quality release" tone={qualityTotals.qcHold > 0 ? "warning" : "default"} />
        <KpiTile label="Blocked" value={`${formatNumber(qualityTotals.blocked)} ${material.uom}`} sublabel="Not usable" tone={qualityTotals.blocked > 0 ? "critical" : "default"} />
      </div>

      {locationQuality.length > 0 && (
        <Panel title="Quality Status by Location" action={!canManageQuality ? <span className="text-xs text-muted-soft">View only</span> : undefined}>
          <QualityPanel materialId={material.id} uom={material.uom} locations={locationQuality} canManage={canManageQuality} />
        </Panel>
      )}

      <Panel title="Locations Holding This Material">
        {locations.length === 0 ? (
          <EmptyState title="Not currently stocked anywhere" />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {locations.map((b) => (
              <div key={b.id} className="rounded-md border border-border-soft bg-surface-raised p-3">
                <div className="text-sm text-foreground">{b.location.name}</div>
                <div className="mt-1 text-xs text-muted-soft">
                  {formatNumber(b.quantity)} {material.uom}
                  {b.location.capacity ? ` — ${((b.quantity / b.location.capacity) * 100).toFixed(0)}% full` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Open Stock Requests" action={<LinkPill href={`/requests?materialId=${material.id}`}>New request →</LinkPill>}>
        {openRequests.length === 0 ? (
          <EmptyState title="No open requests for this material" />
        ) : (
          <div className="space-y-2">
            {openRequests.map((r) => (
              <Link key={r.id} href={`/requests/${r.id}`} className="flex items-center justify-between rounded-md border border-border-soft bg-surface-raised px-3 py-2 text-sm hover:border-accent/40">
                <div>
                  <div className="text-foreground">{r.requestNumber} — {formatNumber(r.quantityRequested - r.receivedQuantity)} {material.uom} remaining</div>
                  <div className="text-xs text-muted-soft">Required by {formatDate(r.requiredByDate)}</div>
                </div>
                <RequestStatusBadge status={r.status as never} />
              </Link>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Consumption History (30 Days)"
        action={<span className="text-xs text-muted-soft">{formatNumber(doc.total30Day)} {material.uom} total &middot; {formatNumber(doc.dailyConsumption)} {material.uom}/day avg</span>}
      >
        {consumptionHistory.length === 0 ? (
          <EmptyState title="No consumption recorded in the last 30 days" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Date</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th>Location</Th>
                  <Th>Reference</Th>
                </tr>
              </thead>
              <tbody>
                {consumptionHistory.map((m) => (
                  <tr key={m.id} className="border-b border-border-soft last:border-0">
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(m.timestamp)}</Td>
                    <Td className="text-right tabular">-{formatNumber(m.quantity)} {m.uom}</Td>
                    <Td className="text-xs text-muted">{m.sourceLocation?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted-soft">{m.reference ?? m.processName ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Recent Movements">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-soft">
                <Th>Timestamp</Th>
                <Th>Type</Th>
                <Th className="text-right">Quantity</Th>
                <Th>From</Th>
                <Th>To</Th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b border-border-soft last:border-0">
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(m.timestamp)}</Td>
                  <Td className="text-xs text-muted">{m.transactionType.replace("_", " ")}</Td>
                  <Td className="text-right tabular">{formatNumber(m.quantity)} {m.uom}</Td>
                  <Td className="text-xs text-muted">{m.sourceLocation?.name ?? "—"}</Td>
                  <Td className="text-xs text-muted">{m.destinationLocation?.name ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
