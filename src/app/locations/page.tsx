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
    // or editable, so it has no business appearing in this management screen. Excludes deleted
    // (active: false) locations too — Delete removes a location from this list entirely.
    prisma.location.findMany({ where: { type: { not: IN_TRANSIT_LOCATION_TYPE }, active: true }, include: { balances: { include: { material: true } } }, orderBy: { name: "asc" } }),
    getCurrentUser(),
  ]);
  const canManage = MASTER_DATA_ROLES.includes(currentUser.role as UserRole);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Locations</h1>
        {!canManage && (
          <p className="mt-2 text-xs text-muted-soft">
            Your role ({ROLE_LABELS[currentUser.role as UserRole]}) has view-only access here — managing locations requires Inventory Manager or Admin.
          </p>
        )}
      </div>

      <Panel title="Locations">
        <LocationsManager
          canEdit={canManage}
          locations={locations.map((l) => {
            // A location can hold more than one material, and materials aren't all the same
            // UOM (e.g. Engineering Store holds both MT gearbox oil and Nos spares) — group by
            // UOM rather than assuming one unit applies to the whole location.
            const stockByUom = new Map<string, number>();
            for (const b of l.balances) stockByUom.set(b.material.uom, (stockByUom.get(b.material.uom) ?? 0) + b.quantity);
            return {
              id: l.id, name: l.name, type: l.type, capacity: l.capacity, capacityUom: l.capacityUom,
              stockQty: l.balances.reduce((s, b) => s + b.quantity, 0),
              stockByUom: Array.from(stockByUom, ([uom, qty]) => ({ uom, qty })),
            };
          })}
        />
      </Panel>
    </div>
  );
}
