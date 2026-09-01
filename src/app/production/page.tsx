import { prisma } from "@/lib/db";
import { Panel, KpiTile, Th, Td, EmptyState, Pill } from "@/components/ui";
import { TrendChart } from "@/components/charts/trend-chart";
import { formatNumber, formatDateTime } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";
import { FULFILMENT_ROLES } from "@/lib/domain/enums";
import { ProductionForm } from "./production-form";

export const dynamic = "force-dynamic";

export default async function ProductionPage() {
  const [outputs, locations, coefficients, recentProduction, currentUser] = await Promise.all([
    prisma.material.findMany({ where: { active: true, category: { in: ["INTERMEDIATE", "FINISHED_GOODS"] } }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.consumptionCoefficient.findMany({ where: { active: true }, include: { inputMaterial: true } }),
    prisma.inventoryTransaction.findMany({ where: { transactionType: "PRODUCTION" }, include: { material: true, destinationLocation: true }, orderBy: { timestamp: "desc" }, take: 20 }),
    getCurrentUser(),
  ]);
  const canRecord = FULFILMENT_ROLES.includes(currentUser.role as "STORE_OPERATOR" | "INVENTORY_MANAGER");

  const since = new Date();
  since.setDate(since.getDate() - 14);
  since.setHours(0, 0, 0, 0);
  const productionSince = await prisma.inventoryTransaction.findMany({
    where: { transactionType: "PRODUCTION", timestamp: { gte: since } },
    include: { material: true },
  });
  const clinkerTotal = productionSince.filter((p) => p.material.name === "Clinker").reduce((s, p) => s + p.quantity, 0);
  const cementTotal = productionSince.filter((p) => p.material.category === "FINISHED_GOODS").reduce((s, p) => s + p.quantity, 0);

  const byDay = new Map<string, number>();
  for (let i = 0; i <= 14; i++) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const p of productionSince.filter((p) => p.material.name === "Clinker")) {
    const k = p.timestamp.toISOString().slice(0, 10);
    if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + p.quantity);
  }
  const clinkerTrend = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, quantity]) => ({ date, quantity }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Production</h1>
        <p className="mt-1 text-sm text-muted">Raw Materials → Raw Meal → Clinker → Cement. Recording production automatically posts the configured consumption for its inputs.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Clinker Production (14d)" value={`${formatNumber(clinkerTotal)} MT`} />
        <KpiTile label="Cement Production (14d)" value={`${formatNumber(cementTotal)} MT`} />
      </div>

      <Panel title="Record Production">
        {canRecord ? (
          <ProductionForm
            outputs={outputs.map((m) => ({ id: m.id, name: m.name, uom: m.uom, defaultLocationId: m.defaultLocationId }))}
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            coefficients={coefficients.map((c) => ({ outputMaterialId: c.outputMaterialId, inputMaterialId: c.inputMaterialId, inputName: c.inputMaterial.name, rate: c.rate }))}
          />
        ) : (
          <p className="text-sm text-muted-soft">
            Your role ({currentUser.role}) cannot record production runs — this requires Store/Inventory Operator or Inventory Manager.
          </p>
        )}
      </Panel>

      <Panel title="Clinker Production Trend (14 days)">
        <TrendChart data={clinkerTrend} dataKey="quantity" unit="MT/day" color="#3aa0ff" />
      </Panel>

      <Panel title="Configured Consumption Coefficients">
        <div className="flex flex-wrap gap-2">
          {coefficients.map((c) => (
            <Pill key={`${c.outputMaterialId}-${c.inputMaterialId}`}>{c.inputMaterial.name} — {c.rate} per unit output</Pill>
          ))}
        </div>
      </Panel>

      <Panel title="Recent Production">
        {recentProduction.length === 0 ? (
          <EmptyState title="No production recorded yet" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Timestamp</Th>
                  <Th>Material</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th>Location</Th>
                  <Th>Process</Th>
                </tr>
              </thead>
              <tbody>
                {recentProduction.map((p) => (
                  <tr key={p.id} className="border-b border-border-soft last:border-0">
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(p.timestamp)}</Td>
                    <Td>{p.material.name}</Td>
                    <Td className="text-right tabular">{formatNumber(p.quantity)} {p.uom}</Td>
                    <Td className="text-xs text-muted">{p.destinationLocation?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted">{p.processName ?? "—"}</Td>
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
