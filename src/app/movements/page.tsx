import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { Panel, Th, Td, EmptyState } from "@/components/ui";
import { formatNumber, formatDateTime } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";
import { FULFILMENT_ROLES } from "@/lib/domain/enums";
import { MovementTabs } from "./movement-tabs";

export const dynamic = "force-dynamic";

export default async function MovementsPage() {
  const [materials, locations, balances, recentMovements, currentUser] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.inventoryBalance.findMany({ where: { quantity: { gt: 1e-6 } }, include: { material: true, location: true } }),
    prisma.inventoryTransaction.findMany({
      include: { material: true, sourceLocation: true, destinationLocation: true },
      orderBy: { timestamp: "desc" },
      take: 15,
    }),
    getCurrentUser(),
  ]);
  const canRecord = FULFILMENT_ROLES.includes(currentUser.role as "STORE_OPERATOR" | "INVENTORY_MANAGER");

  const balanceRows = balances.map((b) => ({
    materialId: b.materialId,
    materialName: b.material.name,
    uom: b.material.uom,
    locationId: b.locationId,
    locationName: b.location.name,
    quantity: b.quantity,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Record Movement</h1>
        <p className="mt-1 text-sm text-muted">Pick what you&apos;re recording. Every action here creates a persisted ledger entry and updates inventory immediately.</p>
      </div>

      <Panel>
        {canRecord ? (
          <Suspense>
            <MovementTabs materials={materials.map((m) => ({ id: m.id, name: m.name, uom: m.uom }))} locations={locations.map((l) => ({ id: l.id, name: l.name }))} balances={balanceRows} />
          </Suspense>
        ) : (
          <p className="text-sm text-muted-soft">
            Your role ({currentUser.role}) cannot record stock movements — this requires Store/Inventory Operator or Inventory Manager.
          </p>
        )}
      </Panel>

      <Panel title="Recent Movements">
        {recentMovements.length === 0 ? (
          <EmptyState title="No movements recorded yet" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Timestamp</Th>
                  <Th>Type</Th>
                  <Th>Material</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th>Reference / Reason</Th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.map((m) => (
                  <tr key={m.id} className="border-b border-border-soft last:border-0">
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(m.timestamp)}</Td>
                    <Td className="text-xs text-muted">{m.transactionType.replace("_", " ")}</Td>
                    <Td>{m.material.name}</Td>
                    <Td className="text-right tabular">{formatNumber(m.quantity)} {m.uom}</Td>
                    <Td className="text-xs text-muted">{m.sourceLocation?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted">{m.destinationLocation?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted-soft">{m.reference ?? m.reason ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
