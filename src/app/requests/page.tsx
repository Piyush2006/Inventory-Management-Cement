import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Panel, Th, Td, EmptyState, LinkPill } from "@/components/ui";
import { RequestStatusBadge } from "@/components/status-badge";
import { formatNumber, formatDate } from "@/lib/format";
import { NewRequestForm } from "./new-request-form";
import { FULFILMENT_ROLES } from "@/lib/domain/enums";

export const dynamic = "force-dynamic";

const OPEN_STATUSES = ["PENDING", "ACCEPTED", "ALLOCATED", "IN_TRANSIT", "PARTIALLY_RECEIVED"];

type RequestRowData = Awaited<ReturnType<typeof getRequests>>[number];

async function getRequests() {
  return prisma.stockRequest.findMany({ include: { material: true, requestedBy: true, toLocation: true }, orderBy: { createdAt: "desc" } });
}

function RequestTable({ rows }: { rows: RequestRowData[] }) {
  if (rows.length === 0) return <EmptyState title="Nothing here" />;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border-soft">
            <Th>Request</Th>
            <Th>Material</Th>
            <Th className="text-right">Requested</Th>
            <Th className="text-right">Received</Th>
            <Th>To</Th>
            <Th>Requested By</Th>
            <Th>Priority</Th>
            <Th>Required By</Th>
            <Th>Status</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border-soft last:border-0">
              <Td className="text-xs text-muted-soft">{r.requestNumber}</Td>
              <Td>{r.material.name}</Td>
              <Td className="text-right tabular">{formatNumber(r.quantityRequested)} {r.material.uom}</Td>
              <Td className="text-right tabular">{formatNumber(r.receivedQuantity)}</Td>
              <Td className="text-xs text-muted">{r.toLocation.name}</Td>
              <Td className="text-xs text-muted">{r.requestedBy.name}</Td>
              <Td>
                {r.priority === "URGENT" ? (
                  <span className="rounded-full bg-[var(--status-critical-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-critical)]">Urgent</span>
                ) : (
                  <span className="text-xs text-muted">Normal</span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-xs text-muted">{formatDate(r.requiredByDate)}</Td>
              <Td><RequestStatusBadge status={r.status as never} /></Td>
              <Td><LinkPill href={`/requests/${r.id}`}>View →</LinkPill></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function RequestsPage() {
  const [materials, locations, requests, currentUser] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true, type: { not: "IN_TRANSIT" } }, orderBy: { name: "asc" } }),
    getRequests(),
    getCurrentUser(),
  ]);

  const open = requests.filter((r) => OPEN_STATUSES.includes(r.status));
  const closed = requests.filter((r) => !OPEN_STATUSES.includes(r.status));
  const isFulfilmentRole = FULFILMENT_ROLES.includes(currentUser.role as "STORE_OPERATOR" | "INVENTORY_MANAGER");
  const needsMyAction = open.filter((r) => {
    if (r.status === "PENDING" || r.status === "ACCEPTED" || r.status === "ALLOCATED" || r.status === "PARTIALLY_RECEIVED") return isFulfilmentRole;
    if (r.status === "IN_TRANSIT") return currentUser.role === "REQUESTER" && r.requestedByUserId === currentUser.id;
    return false;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Stock Requests</h1>
        <p className="mt-1 text-sm text-muted">
          Raise, accept, allocate, issue, and receive — every step of a request stays under the same Request ID.
          Open a request to see its full journey: timeline, quantities at every stage, and every related stock movement.
        </p>
      </div>

      <Panel title="New Stock Request">
        <Suspense>
          <NewRequestForm materials={materials.map((m) => ({ id: m.id, name: m.name, uom: m.uom }))} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />
        </Suspense>
      </Panel>

      {needsMyAction.length > 0 && (
        <Panel title={`Needs Your Action (${needsMyAction.length})`} className="border-accent/30">
          <RequestTable rows={needsMyAction} />
        </Panel>
      )}

      <Panel title={`Open Requests (${open.length})`}>
        <RequestTable rows={open} />
      </Panel>

      <Panel title={`Request History (${closed.length})`}>
        <RequestTable rows={closed} />
      </Panel>
    </div>
  );
}
