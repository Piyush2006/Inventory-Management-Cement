import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Panel, KpiTile, Th, Td, EmptyState } from "@/components/ui";
import { RequestStatusBadge } from "@/components/status-badge";
import { formatNumber, formatDate, formatDateTime } from "@/lib/format";
import { ACCEPT_REJECT_ROLES, ROUTE_ROLES, ASSIGN_ROLES, type UserRole } from "@/lib/domain/enums";
import { RequestActionPanel } from "./request-action-panel";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  REQUEST_CREATED: "Request Created",
  ACCEPTED: "Request Accepted",
  REJECTED: "Request Rejected",
  ROUTED: "Routed to Supervisor",
  ASSIGNED: "Assigned",
  IN_TRANSIT: "In Transit",
  DELIVERED: "Delivered",
  NOT_RECEIVED: "Not Received",
  RECEIVED: "Receipt Confirmed",
  PARTIALLY_RECEIVED: "Partially Received",
  COMPLETED: "Completed",
};

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [request, currentUser, supervisors, operators] = await Promise.all([
    prisma.stockRequest.findUnique({
      where: { id },
      include: {
        material: true,
        fromLocation: true,
        toLocation: true,
        requestedBy: true,
        acceptedBy: true,
        rejectedBy: true,
        routedTo: true,
        assignedTo: true,
        deliveredBy: true,
        events: { include: { user: true }, orderBy: { timestamp: "asc" } },
      },
    }),
    getCurrentUser(),
    prisma.user.findMany({ where: { role: "STORE_SUPERVISOR", active: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: "STORE_OPERATOR", active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!request) notFound();

  const relatedTransactions = await prisma.inventoryTransaction.findMany({
    where: { reference: request.requestNumber },
    include: { sourceLocation: true, destinationLocation: true },
    orderBy: { timestamp: "asc" },
  });

  const remaining = request.quantityRequested - request.receivedQuantity;
  const deliveredNotYetReceived = request.deliveredQuantity - request.receivedQuantity;

  // ACCEPT_REJECT_ROLES / ROUTE_ROLES / ASSIGN_ROLES already include Admin. For the
  // ownership-based checks below, Admin bypasses them explicitly — full access means acting
  // on any request.
  const canAcceptReject = ACCEPT_REJECT_ROLES.includes(currentUser.role as UserRole);
  const canRoute = ROUTE_ROLES.includes(currentUser.role as UserRole);
  const canAssignOperator = ASSIGN_ROLES.includes(currentUser.role as UserRole);
  const isRoutedSupervisor = currentUser.id === request.routedToUserId || currentUser.role === "ADMIN";
  const isAssignedOperator = currentUser.id === request.assignedToUserId || currentUser.role === "ADMIN";
  const isRequester = currentUser.id === request.requestedByUserId || currentUser.role === "ADMIN";

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

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        <KpiTile label="Requested" value={`${formatNumber(request.quantityRequested)}`} />
        <KpiTile label="Delivered" value={formatNumber(request.deliveredQuantity)} />
        <KpiTile label="Received" value={formatNumber(request.receivedQuantity)} tone="healthy" />
        <KpiTile label="Remaining" value={formatNumber(remaining)} tone={remaining > 0 ? "warning" : "healthy"} />
        <KpiTile label="Variance (delivered, unconfirmed)" value={formatNumber(deliveredNotYetReceived)} tone={deliveredNotYetReceived > 0 ? "warning" : "default"} />
      </div>

      <Panel title="Action">
        <RequestActionPanel
          requestId={request.id}
          status={request.status}
          canAcceptReject={canAcceptReject}
          canRoute={canRoute}
          canAssignOperator={canAssignOperator}
          isRoutedSupervisor={isRoutedSupervisor}
          routedToName={request.routedTo?.name ?? null}
          isAssignedOperator={isAssignedOperator}
          isRequester={isRequester}
          supervisors={supervisors.map((s) => ({ id: s.id, name: s.name }))}
          operators={operators.map((o) => ({ id: o.id, name: o.name }))}
          deliveredNotYetReceived={deliveredNotYetReceived}
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
            {request.status === "NOT_RECEIVED" && (
              <>
                <dt className="text-muted">Not Received Reason</dt>
                <dd className="text-[var(--status-critical)]">{request.notReceivedReason}</dd>
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
            <dt className="text-muted">Routed To</dt>
            <dd className="text-foreground">{request.routedTo ? `${request.routedTo.name} — ${formatDateTime(request.routedAt!)}` : "—"}</dd>
            <dt className="text-muted">Assigned To</dt>
            <dd className="text-foreground">{request.assignedTo ? `${request.assignedTo.name} — ${formatDateTime(request.assignedAt!)}` : "—"}</dd>
            <dt className="text-muted">Delivered By</dt>
            <dd className="text-foreground">{request.deliveredBy ? `${request.deliveredBy.name} — ${formatDateTime(request.deliveredAt!)}` : "—"}</dd>
            <dt className="text-muted">Received By</dt>
            <dd className="text-foreground">{request.receivedQuantity > 0 ? request.requestedBy.name : "—"}</dd>
            <dt className="text-muted">Completed</dt>
            <dd className="text-foreground">{request.completedAt ? formatDateTime(request.completedAt) : "—"}</dd>
          </dl>
        </Panel>
      </div>

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
          <EmptyState title="No stock movements yet" body="Movements appear here once delivery starts and receipt is confirmed against this request." />
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
