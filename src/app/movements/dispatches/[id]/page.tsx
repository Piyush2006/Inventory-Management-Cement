import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Panel, KpiTile, EmptyState } from "@/components/ui";
import { formatNumber, formatDate, formatDateTime } from "@/lib/format";
import { getCurrentUser, restrictToRequestsOnly } from "@/lib/auth";
import { DISPATCH_APPROVE_ROLES, DISPATCH_EXECUTE_ROLES, DISPATCH_CANCEL_ROLES, ADMIN_ROLE, type UserRole } from "@/lib/domain/enums";
import { DispatchActionPanel } from "./dispatch-action-panel";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  CREATED: "text-muted bg-surface-raised",
  APPROVED: "text-[var(--status-transit)] bg-[var(--status-transit-bg)]",
  LOADING: "text-[var(--status-warning)] bg-[var(--status-warning-bg)]",
  DISPATCHED: "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]",
  CANCELLED: "text-[var(--status-critical)] bg-[var(--status-critical-bg)]",
};

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Dispatch Created",
  APPROVED: "Approved",
  REASSIGNED: "Operator Reassigned",
  LOADING_STARTED: "Loading Started",
  DISPATCHED: "Dispatched",
  CANCELLED: "Cancelled",
};

export default async function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [dispatch, currentUser, operators] = await Promise.all([
    prisma.dispatch.findUnique({
      where: { id },
      include: {
        material: true,
        sourceLocation: true,
        createdBy: true,
        assignedTo: true,
        approvedBy: true,
        dispatchedBy: true,
        cancelledBy: true,
        events: { include: { user: true }, orderBy: { timestamp: "asc" } },
      },
    }),
    getCurrentUser(),
    prisma.user.findMany({ where: { role: "STORE_OPERATOR", active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!dispatch) notFound();
  restrictToRequestsOnly(currentUser);

  const inventoryTx = dispatch.inventoryTransactionId ? await prisma.inventoryTransaction.findUnique({ where: { id: dispatch.inventoryTransactionId } }) : null;

  const role = currentUser.role as UserRole;
  const canApprove = DISPATCH_APPROVE_ROLES.includes(role);
  const canExecute = DISPATCH_EXECUTE_ROLES.includes(role);
  const canCancel = DISPATCH_CANCEL_ROLES.includes(role);
  const isAssignedOperator = currentUser.id === dispatch.assignedToUserId || role === ADMIN_ROLE;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{dispatch.dispatchReference}</h1>
          <p className="mt-1 text-xs text-muted-soft">
            {dispatch.material.name} &middot; {formatNumber(dispatch.quantity)} {dispatch.material.uom} &middot; to {dispatch.customerDestination}
          </p>
        </div>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${STATUS_TONE[dispatch.status] ?? ""}`}>{dispatch.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Quantity" value={`${formatNumber(dispatch.quantity)} ${dispatch.material.uom}`} />
        <KpiTile label="Source Location" value={dispatch.sourceLocation.name} />
        <KpiTile label="Assigned To" value={dispatch.assignedTo?.name ?? "—"} />
        <KpiTile label="Created" value={formatDate(dispatch.createdAt)} />
      </div>

      <Panel title="Action">
        <DispatchActionPanel
          dispatchId={dispatch.id}
          status={dispatch.status}
          canApprove={canApprove}
          canExecute={canExecute}
          canCancel={canCancel}
          isAssignedOperator={isAssignedOperator}
          operators={operators.map((o) => ({ id: o.id, name: o.name }))}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Dispatch Information">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Material</dt>
            <dd className="text-foreground">{dispatch.material.name}</dd>
            <dt className="text-muted">Source Location</dt>
            <dd className="text-foreground">{dispatch.sourceLocation.name}</dd>
            <dt className="text-muted">Customer / Destination</dt>
            <dd className="text-foreground">{dispatch.customerDestination}</dd>
            <dt className="text-muted">Batch / Lot</dt>
            <dd className="text-foreground">{dispatch.batchLot ?? "—"}</dd>
            <dt className="text-muted">Weighment Reference</dt>
            <dd className="text-foreground">{dispatch.weighmentReference ?? "—"}</dd>
            <dt className="text-muted">Notes</dt>
            <dd className="text-foreground">{dispatch.notes ?? "—"}</dd>
            {dispatch.status === "CANCELLED" && (
              <>
                <dt className="text-muted">Cancellation Reason</dt>
                <dd className="text-[var(--status-critical)]">{dispatch.cancellationReason}</dd>
              </>
            )}
          </dl>
        </Panel>

        <Panel title="People">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Created By</dt>
            <dd className="text-foreground">{dispatch.createdBy.name} — {formatDateTime(dispatch.createdAt)}</dd>
            <dt className="text-muted">Approved By</dt>
            <dd className="text-foreground">{dispatch.approvedBy ? `${dispatch.approvedBy.name} — ${formatDateTime(dispatch.approvedAt!)}` : "—"}</dd>
            <dt className="text-muted">Assigned Operator</dt>
            <dd className="text-foreground">{dispatch.assignedTo?.name ?? "—"}</dd>
            <dt className="text-muted">Loading Started</dt>
            <dd className="text-foreground">{dispatch.loadingStartedAt ? formatDateTime(dispatch.loadingStartedAt) : "—"}</dd>
            <dt className="text-muted">Dispatched By</dt>
            <dd className="text-foreground">{dispatch.dispatchedBy ? `${dispatch.dispatchedBy.name} — ${formatDateTime(dispatch.dispatchedAt!)}` : "—"}</dd>
            <dt className="text-muted">Cancelled By</dt>
            <dd className="text-foreground">{dispatch.cancelledBy ? `${dispatch.cancelledBy.name} — ${formatDateTime(dispatch.cancelledAt!)}` : "—"}</dd>
          </dl>
        </Panel>
      </div>

      <Panel title="Timeline">
        {dispatch.events.length === 0 ? (
          <EmptyState title="No events yet" />
        ) : (
          <ol className="space-y-3 border-l border-border pl-4">
            {dispatch.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-accent" />
                <div className="text-xs text-muted-soft">{formatDateTime(e.timestamp)}</div>
                <div className="text-sm font-medium text-foreground">{EVENT_LABEL[e.action] ?? e.action}</div>
                <div className="text-xs text-muted">
                  {e.user.name} ({e.role}){e.reason ? ` — ${e.reason}` : ""}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Ledger Linkage">
        {inventoryTx ? (
          <div className="rounded-md border border-border-soft bg-surface-raised px-3 py-2 text-sm">
            <span className="text-foreground">{inventoryTx.transactionType}</span> −{formatNumber(inventoryTx.quantity)} {inventoryTx.uom} — {formatDateTime(inventoryTx.timestamp)}
          </div>
        ) : (
          <p className="text-sm text-muted-soft">Not dispatched yet — no ledger entry exists for this dispatch.</p>
        )}
      </Panel>
    </div>
  );
}
