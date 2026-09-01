import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getTotalOnHand, getLocationBalances } from "@/lib/inventory/balance";
import { classifyStockStatus } from "@/lib/inventory/status";
import { computeDaysOfCover } from "@/lib/inventory/daysOfCover";
import { Panel, KpiTile, Th, Td, EmptyState, LinkPill } from "@/components/ui";
import { StatusBadge, RequestStatusBadge } from "@/components/status-badge";
import { formatNumber, formatDateTime, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MaterialDetailPage({ params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) notFound();

  const [currentStock, locations, doc, movements, openRequests] = await Promise.all([
    getTotalOnHand(materialId),
    getLocationBalances(materialId),
    computeDaysOfCover(materialId),
    prisma.inventoryTransaction.findMany({
      where: { materialId },
      include: { sourceLocation: true, destinationLocation: true },
      orderBy: { timestamp: "desc" },
      take: 20,
    }),
    prisma.stockRequest.findMany({ where: { materialId, status: { in: ["PENDING", "ACCEPTED", "ALLOCATED", "IN_TRANSIT", "PARTIALLY_RECEIVED"] } }, orderBy: { requiredByDate: "asc" } }),
  ]);

  const { status, reason } = classifyStockStatus({ currentStock, minStock: material.minStock, safetyStock: material.safetyStock });

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
          <LinkPill href={`/movements?materialId=${material.id}`}>Record Movement</LinkPill>
          <LinkPill href={`/requests?materialId=${material.id}`}>Request Stock</LinkPill>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Current Stock" value={`${formatNumber(currentStock)} ${material.uom}`} />
        <KpiTile label="Min Stock" value={material.minStock != null ? formatNumber(material.minStock) : "—"} />
        <KpiTile label="Safety Stock" value={material.safetyStock != null ? formatNumber(material.safetyStock) : "—"} />
        <KpiTile label="Days of Cover" value={doc.na ? "N/A" : `${doc.daysCover?.toFixed(1)}d`} />
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Status</span>
        <StatusBadge status={status} />
        <span className="text-xs text-muted">{reason}</span>
      </div>

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
