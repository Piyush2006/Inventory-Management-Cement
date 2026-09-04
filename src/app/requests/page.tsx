import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Panel, Th, EmptyState } from "@/components/ui";
import { ExportCsvButton } from "@/components/export-csv-button";
import { formatDate } from "@/lib/format";
import { IN_TRANSIT_LOCATION_TYPE, ACCEPT_REJECT_ROLES, ROUTE_ROLES, ASSIGN_ROLES, OPEN_REQUEST_STATUSES, REQUEST_TYPES, type UserRole } from "@/lib/domain/enums";
import { NewRequestForm } from "./new-request-form";
import { RequestTabs } from "./request-tabs";
import { RequestListRow } from "./request-list-row";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const OPEN_STATUSES = OPEN_REQUEST_STATUSES;
const CLOSED_STATUSES = ["COMPLETED", "REJECTED"];

type RequestRow = Prisma.StockRequestGetPayload<{ include: { material: true; requestedBy: true; assignedTo: true; routedTo: true } }>;
type CurrentUser = { id: string; role: string };
type Person = { id: string; name: string };

function RequestTable({
  rows, emptyTitle, currentUser, supervisors, operators, exportFilename,
}: {
  rows: RequestRow[];
  emptyTitle: string;
  currentUser: CurrentUser;
  supervisors: Person[];
  operators: Person[];
  exportFilename: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} />;
  // Admin has full access per the RBAC matrix — it can act as the accepter/rejecter, the
  // router, the routed-to supervisor, the assigned operator, or the requester on any row,
  // not just ones it's tied to.
  const isAdmin = currentUser.role === "ADMIN";
  const canAcceptReject = ACCEPT_REJECT_ROLES.includes(currentUser.role as UserRole);
  const canRoute = ROUTE_ROLES.includes(currentUser.role as UserRole);
  const canAssignOperator = ASSIGN_ROLES.includes(currentUser.role as UserRole);
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <ExportCsvButton
          filename={exportFilename}
          headers={["Request ID", "Material", "Purpose", "Type", "Qty Requested", "Requested By", "Routed To", "Assigned To", "Required By", "Status"]}
          rows={rows.map((r) => [r.requestNumber, r.material.name, r.purpose === "ISSUE" ? "Issue" : "Transfer", r.requestType === "SPARE" ? "Spare" : "Material", r.quantityRequested, r.requestedBy.name, r.routedTo?.name ?? "", r.assignedTo?.name ?? "", formatDate(r.requiredByDate), r.status])}
        />
      </div>
      <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border-soft">
            <Th>Request ID</Th>
            <Th>Material</Th>
            <Th>Purpose</Th>
            <Th>Type</Th>
            <Th className="text-right">Qty</Th>
            <Th>Requested By</Th>
            <Th>Assigned To</Th>
            <Th>Required By</Th>
            <Th>Status</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <RequestListRow
              key={r.id}
              id={r.id}
              requestNumber={r.requestNumber}
              materialName={r.material.name}
              purpose={r.purpose}
              requestType={r.requestType}
              uom={r.material.uom}
              quantityRequested={r.quantityRequested}
              requestedByName={r.requestedBy.name}
              assignedToName={r.assignedTo?.name ?? null}
              routedToName={r.routedTo?.name ?? null}
              requiredByDate={r.requiredByDate}
              status={r.status}
              canAcceptReject={canAcceptReject}
              canRoute={canRoute}
              canAssignOperator={canAssignOperator}
              isRoutedSupervisor={r.routedToUserId === currentUser.id || isAdmin}
              isAssignedOperator={r.assignedToUserId === currentUser.id || isAdmin}
              isRequester={r.requestedByUserId === currentUser.id || isAdmin}
              supervisors={supervisors}
              operators={operators}
              deliveredNotYetReceived={r.deliveredQuantity - r.receivedQuantity}
            />
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const params = await searchParams;
  const [materials, spareMaterials, locations, supervisors, operators, currentUser] = await Promise.all([
    prisma.material.findMany({ where: { active: true, category: { not: "SPARE" } }, orderBy: { name: "asc" } }),
    prisma.material.findMany({ where: { active: true, category: "SPARE" }, orderBy: { name: "asc" } }),
    // Excludes the virtual in-transit location from the From/To pickers — a request can only
    // move material between two real locations, never to/from the system's internal bucket.
    prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: "STORE_SUPERVISOR", active: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: "STORE_OPERATOR", active: true }, orderBy: { name: "asc" } }),
    getCurrentUser(),
  ]);

  const include = { material: true, requestedBy: true, assignedTo: true, routedTo: true } as const;

  // Per the RBAC matrix: Requester sees only their own requests, Store Operator only the
  // ones assigned to them — everyone else (Store Supervisor "Manage", Inventory Manager
  // "All", Admin "Full") sees every request, since they're responsible for the whole queue.
  // The "needs your action" queue was dropped as a separate tab (every one of its rows is
  // already a subset of Open Requests' broader status set, so nothing is lost — it's still
  // visible there, just not called out in its own tab).
  let openWhere: Prisma.StockRequestWhereInput;
  let historyWhere: Prisma.StockRequestWhereInput;
  if (currentUser.role === "REQUESTER") {
    openWhere = { requestedByUserId: currentUser.id, status: { in: OPEN_STATUSES } };
    historyWhere = { requestedByUserId: currentUser.id, status: { in: CLOSED_STATUSES } };
  } else if (currentUser.role === "STORE_OPERATOR") {
    openWhere = { assignedToUserId: currentUser.id, status: { in: OPEN_STATUSES } };
    historyWhere = { assignedToUserId: currentUser.id, status: { in: CLOSED_STATUSES } };
  } else {
    // Admin, Inventory Manager, Store Supervisor all see every request — they're each
    // responsible for the whole queue at their stage, not just requests tied to them.
    openWhere = { status: { in: OPEN_STATUSES } };
    historyWhere = { status: { in: CLOSED_STATUSES } };
  }
  if (params.type) {
    openWhere = { ...openWhere, requestType: params.type };
    historyWhere = { ...historyWhere, requestType: params.type };
  }

  const [openRows, historyRows] = await Promise.all([
    prisma.stockRequest.findMany({ where: openWhere, include, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.stockRequest.findMany({ where: historyWhere, include, orderBy: { updatedAt: "desc" }, take: 30 }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Requests</h1>
      </div>

      <Panel>
        <form className="grid grid-cols-2 gap-3 sm:grid-cols-4" method="GET">
          <label className="text-xs text-muted">
            Type
            <select name="type" defaultValue={params.type ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              <option value="">All types</option>
              {REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>{t === "SPARE" ? "Spare" : "Material"}</option>
              ))}
            </select>
          </label>
        </form>
      </Panel>

      <Panel>
        <RequestTabs
          openContent={<RequestTable rows={openRows} emptyTitle="No open requests" currentUser={currentUser} supervisors={supervisors} operators={operators} exportFilename="requests-open.csv" />}
          historyContent={<RequestTable rows={historyRows} emptyTitle="No completed or rejected requests yet" currentUser={currentUser} supervisors={supervisors} operators={operators} exportFilename="requests-history.csv" />}
          newRequestContent={
            <NewRequestForm
              materials={materials.map((m) => ({ id: m.id, name: m.name, uom: m.uom }))}
              spareMaterials={spareMaterials.map((m) => ({ id: m.id, name: m.name, uom: m.uom, equipmentRef: m.equipmentRef }))}
              locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            />
          }
        />
      </Panel>
    </div>
  );
}
