import { prisma } from "@/lib/db";
import { Panel } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { MASTER_DATA_ROLES, IN_TRANSIT_LOCATION_TYPE, ROLE_LABELS, type UserRole } from "@/lib/domain/enums";
import { LocationsManager } from "./locations-manager";

export const dynamic = "force-dynamic";

// No restrictToRequestsOnly gate — Indentor (Requester) has full read access; edit controls
// stay behind canManage/MASTER_DATA_ROLES exactly as before, unaffected by this.
export default async function LocationsPage() {
  const [locations, currentUser] = await Promise.all([
    // Excludes the system-managed virtual in-transit location — it's not user-creatable
    // or editable, so it has no business appearing in this management screen.
    prisma.location.findMany({ where: { type: { not: IN_TRANSIT_LOCATION_TYPE } }, include: { balances: true }, orderBy: { name: "asc" } }),
    getCurrentUser(),
  ]);
  const canManage = MASTER_DATA_ROLES.includes(currentUser.role as UserRole);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Locations</h1>
        <p className="mt-1 text-sm text-muted">
          Add, edit, and deactivate storage locations. Locations with stock on hand are never hard-deleted — only deactivated.
        </p>
        {!canManage && (
          <p className="mt-2 text-xs text-muted-soft">
            Your role ({ROLE_LABELS[currentUser.role as UserRole]}) has view-only access here — managing locations requires Inventory Manager or Admin.
          </p>
        )}
      </div>

      <Panel title="Locations">
        <LocationsManager
          canEdit={canManage}
          locations={locations.map((l) => ({
            id: l.id, name: l.name, type: l.type, capacity: l.capacity, active: l.active,
            stockQty: l.balances.reduce((s, b) => s + b.quantity, 0),
          }))}
        />
      </Panel>
    </div>
  );
}
