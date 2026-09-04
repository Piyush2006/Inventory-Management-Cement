import { prisma } from "@/lib/db";
import { Panel } from "@/components/ui";
import { getCurrentUser, restrictToRequestsOnly, restrictStockOperationsFromSupervisor } from "@/lib/auth";
import { STOCK_OPS_ROLES, IN_TRANSIT_LOCATION_TYPE, ROLE_LABELS, type UserRole } from "@/lib/domain/enums";
import { ReceiptForm } from "./receipt-form";

export const dynamic = "force-dynamic";

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ materialId?: string; purchaseReferenceId?: string }>;
}) {
  const params = await searchParams;
  const [materials, locations, suppliers, openPos, currentUser] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.purchaseReference.findMany({ where: { status: { in: ["EXPECTED", "PARTIALLY_RECEIVED"] } }, include: { supplier: true, material: true }, orderBy: { createdAt: "desc" } }),
    getCurrentUser(),
  ]);
  restrictToRequestsOnly(currentUser);
  restrictStockOperationsFromSupervisor(currentUser);
  const canRecord = STOCK_OPS_ROLES.includes(currentUser.role as UserRole);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Receive Material</h1>
        <p className="mt-1 text-sm text-muted">Create a GRN against an existing purchase reference, or receive directly with no PO.</p>
      </div>

      <Panel>
        {!canRecord ? (
          <p className="text-sm text-muted-soft">
            Your role ({ROLE_LABELS[currentUser.role as UserRole]}) cannot receive material — this requires Store/Delivery Operator, Inventory Manager, or Admin.
          </p>
        ) : (
          <ReceiptForm
            materials={materials.map((m) => ({ id: m.id, name: m.name, uom: m.uom }))}
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
            purchaseReferences={openPos.map((p) => ({
              id: p.id, poNumber: p.poNumber, materialId: p.materialId, materialName: p.material.name,
              supplierId: p.supplierId, supplierName: p.supplier.name, orderedQuantity: p.orderedQuantity, uom: p.material.uom,
            }))}
            defaultMaterialId={params.materialId}
            defaultPurchaseReferenceId={params.purchaseReferenceId}
          />
        )}
      </Panel>
    </div>
  );
}
