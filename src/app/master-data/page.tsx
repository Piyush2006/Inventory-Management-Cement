import { prisma } from "@/lib/db";
import { Panel } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { MASTER_DATA_ROLES } from "@/lib/domain/enums";
import { MaterialsManager } from "./materials-manager";
import { LocationsManager } from "./locations-manager";

export const dynamic = "force-dynamic";

export default async function MasterDataPage() {
  const [materials, locations, currentUser] = await Promise.all([
    prisma.material.findMany({ orderBy: { name: "asc" } }),
    prisma.location.findMany({ include: { balances: true }, orderBy: { name: "asc" } }),
    getCurrentUser(),
  ]);
  const canManage = MASTER_DATA_ROLES.includes(currentUser.role as "INVENTORY_MANAGER");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Materials & Locations</h1>
        <p className="mt-1 text-sm text-muted">
          Add, edit, and deactivate the material master and storage locations. A material appears in Inventory,
          Record Movement, and Stock Requests the moment it&apos;s saved. Materials and locations with transaction
          history are never hard-deleted — only deactivated.
        </p>
        {!canManage && (
          <p className="mt-2 text-xs text-muted-soft">
            Your role ({currentUser.role}) has view-only access here — managing materials and locations requires Inventory Manager.
          </p>
        )}
      </div>

      <Panel title="Materials">
        <MaterialsManager
          canEdit={canManage}
          materials={materials.map((m) => ({
            id: m.id, materialCode: m.materialCode, name: m.name, category: m.category, uom: m.uom,
            minStock: m.minStock, safetyStock: m.safetyStock, defaultLocationId: m.defaultLocationId,
            productGrade: m.productGrade, bagWeightKg: m.bagWeightKg, active: m.active,
          }))}
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        />
      </Panel>

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
