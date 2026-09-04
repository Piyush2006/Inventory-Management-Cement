import { prisma } from "@/lib/db";
import { Panel } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { MASTER_DATA_ROLES, IN_TRANSIT_LOCATION_TYPE, ROLE_LABELS, type UserRole } from "@/lib/domain/enums";
import { MaterialsManager } from "./materials-manager";

export const dynamic = "force-dynamic";

// No restrictToRequestsOnly gate — Indentor (Requester) has full read access; edit controls
// stay behind canManage/MASTER_DATA_ROLES exactly as before, unaffected by this.
export default async function MaterialsPage() {
  const [materials, locations, currentUser] = await Promise.all([
    // Deleted (active: false) materials disappear from this list entirely — Delete removes a
    // material from view, matching Locations' behavior.
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    // Excludes the virtual in-transit location from the "Default location" picker.
    prisma.location.findMany({ where: { type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
    getCurrentUser(),
  ]);
  const canManage = MASTER_DATA_ROLES.includes(currentUser.role as UserRole);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Materials</h1>
        {!canManage && (
          <p className="mt-2 text-xs text-muted-soft">
            Your role ({ROLE_LABELS[currentUser.role as UserRole]}) has view-only access here — managing materials requires Inventory Manager or Admin.
          </p>
        )}
      </div>

      <Panel title="Materials">
        <MaterialsManager
          canEdit={canManage}
          materials={materials.map((m) => ({
            id: m.id, materialCode: m.materialCode, name: m.name, category: m.category, uom: m.uom,
            minStock: m.minStock, maxStock: m.maxStock, defaultLocationId: m.defaultLocationId,
            partNumber: m.partNumber, manufacturer: m.manufacturer, equipmentRef: m.equipmentRef, criticality: m.criticality,
          }))}
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        />
      </Panel>
    </div>
  );
}
