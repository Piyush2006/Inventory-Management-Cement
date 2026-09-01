import { prisma } from "@/lib/db";
import { Panel } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { FULFILMENT_ROLES } from "@/lib/domain/enums";
import { ReceiptForm } from "./receipt-form";

export const dynamic = "force-dynamic";

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ materialId?: string; purchaseReferenceId?: string; stockRequestId?: string }>;
}) {
  const params = await searchParams;
  const [materials, locations, suppliers, openPos, currentUser] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.purchaseReference.findMany({ where: { status: { in: ["EXPECTED", "PARTIALLY_RECEIVED"] } }, include: { supplier: true, material: true }, orderBy: { createdAt: "desc" } }),
    getCurrentUser(),
  ]);
  const canRecord = FULFILMENT_ROLES.includes(currentUser.role as "STORE_OPERATOR" | "INVENTORY_MANAGER");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Receive Material</h1>
        <p className="mt-1 text-sm text-muted">Create a GRN against an existing purchase reference, or receive directly with no PO.</p>
      </div>

      <Panel>
        {!canRecord ? (
          <p className="text-sm text-muted-soft">
            Your role ({currentUser.role}) cannot receive material — this requires Store/Inventory Operator or Inventory Manager.
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
            defaultStockRequestId={params.stockRequestId}
          />
        )}
      </Panel>
    </div>
  );
}
