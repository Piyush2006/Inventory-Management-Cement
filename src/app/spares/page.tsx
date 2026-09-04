import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Panel } from "@/components/ui";
import { classifyStockStatus } from "@/lib/inventory/status";
import { MASTER_DATA_ROLES, IN_TRANSIT_LOCATION_TYPE, ACCEPT_REJECT_ROLES, ROUTE_ROLES, ASSIGN_ROLES, type UserRole } from "@/lib/domain/enums";
import type { Prisma } from "@prisma/client";
import { SpareTabs } from "./spare-tabs";

export const dynamic = "force-dynamic";

// Same visibility as Inventory — no restrictToRequestsOnly gate. Every tab here is a filtered
// view of Material/StockRequest data that already exists; nothing here is a second data source.
export default async function SpareManagementPage() {
  const currentUser = await getCurrentUser();
  const canManageMasterData = MASTER_DATA_ROLES.includes(currentUser.role as UserRole);

  const [spareMaterials, locations] = await Promise.all([
    prisma.material.findMany({
      where: { category: "SPARE" },
      include: { balances: { where: { location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } }, include: { location: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
  ]);
  const spareMaterialIds = spareMaterials.map((m) => m.id);

  // Batched — avoids an N+1 call per spare, same pattern already used in inventory/page.tsx and dashboard.ts.
  const [qualityBalances, reservations] = await Promise.all([
    prisma.qualityBalance.findMany({ where: { materialId: { in: spareMaterialIds } } }),
    prisma.stockReservation.groupBy({ by: ["materialId"], where: { materialId: { in: spareMaterialIds }, status: "ACTIVE" }, _sum: { quantity: true } }),
  ]);
  const qualityByMaterial = new Map<string, { qcHold: number; blocked: number }>();
  for (const q of qualityBalances) {
    const entry = qualityByMaterial.get(q.materialId) ?? { qcHold: 0, blocked: 0 };
    if (q.status === "QC_HOLD") entry.qcHold += q.quantity;
    if (q.status === "BLOCKED") entry.blocked += q.quantity;
    qualityByMaterial.set(q.materialId, entry);
  }
  const reservedByMaterial = new Map(reservations.map((r) => [r.materialId, r._sum.quantity ?? 0]));

  const inventoryRows = spareMaterials.map((m) => {
    const onHand = m.balances.reduce((s, b) => s + b.quantity, 0);
    const reserved = reservedByMaterial.get(m.id) ?? 0;
    const available = onHand - reserved;
    const { qcHold, blocked } = qualityByMaterial.get(m.id) ?? { qcHold: 0, blocked: 0 };
    const unrestricted = Math.max(0, onHand - qcHold - blocked);
    const { status } = classifyStockStatus({ currentStock: unrestricted, minStock: m.minStock, safetyStock: m.safetyStock });
    const locationBreakdown = m.balances
      .filter((b) => Math.abs(b.quantity) > 1e-6)
      .map((b) => ({ id: b.locationId, name: b.location.name, quantity: b.quantity }))
      .sort((a, b) => b.quantity - a.quantity);
    return {
      materialId: m.id, code: m.materialCode, name: m.name, uom: m.uom,
      equipmentRef: m.equipmentRef, criticality: m.criticality ?? "NORMAL",
      onHand, reserved, available, qcHold, blocked,
      minStock: m.minStock, safetyStock: m.safetyStock, status, locationBreakdown,
    };
  });

  // Spare Requests — same RBAC scoping requests/page.tsx already uses, filtered to requestType SPARE.
  const include = { material: true, requestedBy: true, assignedTo: true, routedTo: true } as const;
  let requestsWhere: Prisma.StockRequestWhereInput = { requestType: "SPARE" };
  if (currentUser.role === "REQUESTER") requestsWhere = { ...requestsWhere, requestedByUserId: currentUser.id };
  else if (currentUser.role === "STORE_OPERATOR") requestsWhere = { ...requestsWhere, assignedToUserId: currentUser.id };

  const [spareRequests, supervisors, operators] = await Promise.all([
    prisma.stockRequest.findMany({ where: requestsWhere, include, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.user.findMany({ where: { role: "STORE_SUPERVISOR", active: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: "STORE_OPERATOR", active: true }, orderBy: { name: "asc" } }),
  ]);

  const isAdmin = currentUser.role === "ADMIN";
  const canAcceptReject = ACCEPT_REJECT_ROLES.includes(currentUser.role as UserRole);
  const canRoute = ROUTE_ROLES.includes(currentUser.role as UserRole);
  const canAssignOperator = ASSIGN_ROLES.includes(currentUser.role as UserRole);

  const requestRows = spareRequests.map((r) => ({
    id: r.id, requestNumber: r.requestNumber, materialName: r.material.name, purpose: r.purpose, uom: r.material.uom,
    quantityRequested: r.quantityRequested, requestedByName: r.requestedBy.name,
    assignedToName: r.assignedTo?.name ?? null, routedToName: r.routedTo?.name ?? null,
    requiredByDate: r.requiredByDate, status: r.status,
    isRoutedSupervisor: r.routedToUserId === currentUser.id || isAdmin,
    isAssignedOperator: r.assignedToUserId === currentUser.id || isAdmin,
    isRequester: r.requestedByUserId === currentUser.id || isAdmin,
    deliveredNotYetReceived: r.deliveredQuantity - r.receivedQuantity,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Spare Management</h1>
        <p className="mt-1 text-sm text-muted">
          Spares are materials, and spare requests are stock requests — every tab below is a filtered view of the same Inventory, Requests, and Materials data, not a separate system.
        </p>
      </div>

      <Panel>
        <SpareTabs
          inventoryRows={inventoryRows}
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          requestRows={requestRows}
          canAcceptReject={canAcceptReject}
          canRoute={canRoute}
          canAssignOperator={canAssignOperator}
          supervisors={supervisors.map((s) => ({ id: s.id, name: s.name }))}
          operators={operators.map((o) => ({ id: o.id, name: o.name }))}
          masterMaterials={spareMaterials.map((m) => ({
            id: m.id, materialCode: m.materialCode, name: m.name, category: m.category, uom: m.uom,
            minStock: m.minStock, safetyStock: m.safetyStock, defaultLocationId: m.defaultLocationId, active: m.active,
            partNumber: m.partNumber, manufacturer: m.manufacturer, equipmentRef: m.equipmentRef, criticality: m.criticality,
          }))}
          masterLocations={locations.map((l) => ({ id: l.id, name: l.name }))}
          canManageMasterData={canManageMasterData}
        />
      </Panel>
    </div>
  );
}
