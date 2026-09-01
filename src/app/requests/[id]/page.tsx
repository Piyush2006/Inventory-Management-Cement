import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Panel, KpiTile, Th, Td, EmptyState } from "@/components/ui";
import { RequestStatusBadge } from "@/components/status-badge";
import { formatNumber, formatDate, formatDateTime } from "@/lib/format";
import { FULFILMENT_ROLES } from "@/lib/domain/enums";
import { RequestActionPanel } from "./request-action-panel";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  REQUEST_RAISED: "Request Raised",
  ACCEPTED: "Request Accepted",
  REJECTED: "Request Rejected",
  ALLOCATED: "Stock Allocated",
  ISSUED: "Stock Issued — In Transit",
  RECEIVED: "Material Received",
  PARTIALLY_RECEIVED: "Material Partially Received",
  COMPLETED: "Request Completed",
  CANCELLED: "Request Cancelled",
};

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [request, currentUser] = await Promise.all([
    prisma.stockRequest.findUnique({
      where: { id },
      include: {
        material: true,
        fromLocation: true,
        toLocation: true,
        requestedBy: true,
        acceptedBy: true,
        rejectedBy: true,
        events: { include: { user: true }, orderBy: { timestamp: "asc" } },
        purchaseReferences: { include: { supplier: true } },
        materialReceipts: { include: { supplier: true } },
      },
    }),
    getCurrentUser(),
  ]);
  if (!request) notFound();

  const relatedTransactions = await prisma.inventoryTransaction.findMany({
    where: { reference: request.requestNumber },
    include: { sourceLocation: true, destinationLocation: true },
    orderBy: { timestamp: "asc" },
  });

  const remainingToAllocate = request.quantityRequested - request.allocatedQuantity;
  const activeReserved = request.allocatedQuantity - request.issuedQuantity;
  const inTransitForRequest = request.issuedQuantity - request.receivedQuantity;
  const remaining = request.quantityRequested - request.receivedQuantity;

  const isFulfilmentRole = FULFILMENT_ROLES.includes(currentUser.role as "STORE_OPERATOR" | "INVENTORY_MANAGER");
  const isRequester = currentUser.role === "REQUESTER";
  const isOwnRequest = currentUser.id === request.requestedByUserId;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{request.requestNumber}</h1>
          <p className="mt-1 text-xs text-muted-soft">
            {request.material.name} &middot; {formatNumber(request.quantityRequested)} {request.material.uom} &middot; requested by {request.requestedBy.name}
          </p>
        </div>
        <RequestStatusBadge status={request.status as never} />
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        <KpiTile label="Requested" value={`${formatNumber(request.quantityRequested)}`} />
        <KpiTile label="Allocated" value={formatNumber(request.allocatedQuantity)} />
        <KpiTile label="Issued" value={formatNumber(request.issuedQuantity)} />
        <KpiTile label="In Transit" value={formatNumber(inTransitForRequest)} tone={inTransitForRequest > 0 ? "warning" : "default"} />
        <KpiTile label="Received" value={formatNumber(request.receivedQuantity)} tone="healthy" />
        <KpiTile label="Remaining" value={formatNumber(remaining)} tone={remaining > 0 ? "warning" : "healthy"} />
      </div>

      <Panel title="Action">
        <RequestActionPanel
          requestId={request.id}
          status={request.status}
          isFulfilmentRole={isFulfilmentRole}
          isRequester={isRequester}
          isOwnRequest={isOwnRequest}
          remainingToAllocate={remainingToAllocate}
          activeReserved={activeReserved}
          inTransitForRequest={inTransitForRequest}
          uom={request.material.uom}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Request Information">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Material</dt>
            <dd className="text-foreground">{request.material.name}</dd>
            <dt className="text-muted">Priority</dt>
            <dd className="text-foreground">{request.priority}</dd>
            <dt className="text-muted">Required By</dt>
            <dd className="text-foreground">{formatDate(request.requiredByDate)}</dd>
            <dt className="text-muted">From Location</dt>
            <dd className="text-foreground">{request.fromLocation.name}</dd>
            <dt className="text-muted">To Location</dt>
            <dd className="text-foreground">{request.toLocation.name}</dd>
            <dt className="text-muted">Reason</dt>
            <dd className="text-foreground">{request.reason ?? "—"}</dd>
            <dt className="text-muted">Notes</dt>
            <dd className="text-foreground">{request.note ?? "—"}</dd>
            {request.status === "REJECTED" && (
              <>
                <dt className="text-muted">Rejection Reason</dt>
                <dd className="text-[var(--status-critical)]">{request.rejectionReason}</dd>
              </>
            )}
          </dl>
        </Panel>

        <Panel title="People">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Requested By</dt>
            <dd className="text-foreground">{request.requestedBy.name} <span className="text-xs text-muted-soft">({request.requestedByRole})</span></dd>
            <dt className="text-muted">Accepted By</dt>
            <dd className="text-foreground">{request.acceptedBy ? `${request.acceptedBy.name} — ${formatDateTime(request.acceptedAt!)}` : "—"}</dd>
            <dt className="text-muted">Rejected By</dt>
            <dd className="text-foreground">{request.rejectedBy ? `${request.rejectedBy.name} — ${formatDateTime(request.rejectedAt!)}` : "—"}</dd>
            <dt className="text-muted">Completed</dt>
            <dd className="text-foreground">{request.completedAt ? formatDateTime(request.completedAt) : "—"}</dd>
          </dl>
        </Panel>
      </div>

      {(request.purchaseReferences.length > 0 || request.materialReceipts.length > 0) && (
        <Panel title="External Replenishment (Purchase Reference / GRN)">
          <div className="space-y-2 text-sm">
            {request.purchaseReferences.map((po) => (
              <div key={po.id} className="flex items-center justify-between rounded-md border border-border-soft bg-surface-raised px-3 py-2">
                <span className="text-foreground">{po.poNumber} — {po.supplier.name} — {formatNumber(po.orderedQuantity)} {request.material.uom} ordered</span>
                <span className="text-xs text-muted">{po.status.replace("_", " ")}</span>
              </div>
            ))}
            {request.materialReceipts.map((grn) => (
              <div key={grn.id} className="flex items-center justify-between rounded-md border border-border-soft bg-surface-raised px-3 py-2">
                <Link href={`/receipts/${grn.id}`} className="text-accent hover:underline">{grn.grnNumber}</Link>
                <span className="text-xs text-muted">Accepted {formatNumber(grn.acceptedQuantity)} {request.material.uom} &middot; {grn.status}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Timeline">
        {request.events.length === 0 ? (
          <EmptyState title="No events yet" />
        ) : (
          <ol className="space-y-3 border-l border-border pl-4">
            {request.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-accent" />
                <div className="text-xs text-muted-soft">{formatDateTime(e.timestamp)}</div>
                <div className="text-sm font-medium text-foreground">{EVENT_LABEL[e.action] ?? e.action}</div>
                <div className="text-xs text-muted">
                  {e.user.name} ({e.role})
                  {e.quantity != null ? ` — ${formatNumber(e.quantity)} ${request.material.uom}` : ""}
                  {e.reason ? ` — ${e.reason}` : ""}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Related Stock Movements">
        {relatedTransactions.length === 0 ? (
          <EmptyState title="No stock movements yet" body="Movements appear here once stock is allocated, issued, or received against this request." />
        ) : (
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
                {relatedTransactions.map((t) => (
                  <tr key={t.id} className="border-b border-border-soft last:border-0">
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(t.timestamp)}</Td>
                    <Td className="text-xs text-muted">{t.transactionType.replace("_", " ")}</Td>
                    <Td className="text-right tabular">{formatNumber(t.quantity)} {t.uom}</Td>
                    <Td className="text-xs text-muted">{t.sourceLocation?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted">{t.destinationLocation?.name ?? "—"}</Td>
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
