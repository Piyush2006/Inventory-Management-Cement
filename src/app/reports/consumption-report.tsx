import { prisma } from "@/lib/db";
import { Panel, Th, Td, EmptyState } from "@/components/ui";
import { ExportCsvButton } from "@/components/export-csv-button";
import { ReportFilterBar } from "./report-filter-bar";
import { getConsumptionReport } from "@/lib/reports/consumption";
import { formatNumber, formatDateTime } from "@/lib/format";
import { IN_TRANSIT_LOCATION_TYPE } from "@/lib/domain/enums";
import { parseDateRangeParams } from "@/lib/reports/types";

export async function ConsumptionReportSection({ params }: { params: Record<string, string | undefined> }) {
  const [materials, locations] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
  ]);

  const { from, to } = parseDateRangeParams(params.from, params.to);
  const report = await getConsumptionReport({ from, to, materialId: params.materialId, locationId: params.locationId, category: params.category });

  return (
    <div className="space-y-4">
      <ReportFilterBar
        tab="consumption"
        fields={["dateRange", "material", "location", "category"]}
        params={params}
        materials={materials.map((m) => ({ value: m.id, label: m.name }))}
        locations={locations.map((l) => ({ value: l.id, label: l.name }))}
      />

      <Panel
        title="Average Consumption by Material"
        action={
          <ExportCsvButton
            filename="consumption-detail.csv"
            headers={["Date", "Material", "Category", "Location", "Consumed Quantity", "UOM", "Reference"]}
            rows={report.detailRows.map((r) => [formatDateTime(r.timestamp), r.materialName, r.category.replace("_", " "), r.locationName, formatNumber(r.quantity), r.uom, r.reference ?? ""])}
          />
        }
      >
        {report.aggregateRows.length === 0 ? (
          <EmptyState title="No consumption in this range" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Material</Th>
                  <Th>Category</Th>
                  <Th className="text-right">Total Consumed</Th>
                  <Th className="text-right">Average Daily Consumption</Th>
                </tr>
              </thead>
              <tbody>
                {report.aggregateRows.map((r) => (
                  <tr key={r.materialId} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                    <Td>{r.materialName}</Td>
                    <Td className="text-xs text-muted">{r.category.replace("_", " ")}</Td>
                    <Td className="text-right tabular">{formatNumber(r.totalConsumed)} {r.uom}</Td>
                    <Td className="text-right tabular">{formatNumber(r.averageDailyConsumption, 1)} {r.uom}/day</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={`Consumption Detail (${report.detailRows.length})`}>
        {report.detailRows.length === 0 ? (
          <EmptyState title="No consumption in this range" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Date</Th>
                  <Th>Material</Th>
                  <Th>Category</Th>
                  <Th>Location</Th>
                  <Th className="text-right">Consumed Quantity</Th>
                  <Th>Reference</Th>
                </tr>
              </thead>
              <tbody>
                {report.detailRows.map((r) => (
                  <tr key={r.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(r.timestamp)}</Td>
                    <Td>{r.materialName}</Td>
                    <Td className="text-xs text-muted">{r.category.replace("_", " ")}</Td>
                    <Td className="text-xs text-muted">{r.locationName}</Td>
                    <Td className="text-right tabular">{formatNumber(r.quantity)} {r.uom}</Td>
                    <Td className="text-xs text-muted-soft">{r.reference ?? "—"}</Td>
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
