import { prisma } from "@/lib/db";
import { Panel, Th, Td, KpiTile, EmptyState } from "@/components/ui";
import { ExportCsvButton } from "@/components/export-csv-button";
import { ReportFilterBar } from "./report-filter-bar";
import { getInventoryReport } from "@/lib/reports/inventory";
import { formatNumber } from "@/lib/format";
import { IN_TRANSIT_LOCATION_TYPE } from "@/lib/domain/enums";
import { parseDateRangeParams } from "@/lib/reports/types";

export async function InventoryReportSection({ params }: { params: Record<string, string | undefined> }) {
  const [materials, locations] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
  ]);

  const { from, to } = parseDateRangeParams(params.from, params.to);
  const report = await getInventoryReport({ from, to, materialId: params.materialId, locationId: params.locationId, category: params.category });

  return (
    <div className="space-y-4">
      <ReportFilterBar
        tab="inventory"
        fields={["dateRange", "material", "location", "category"]}
        params={params}
        materials={materials.map((m) => ({ value: m.id, label: m.name }))}
        locations={locations.map((l) => ({ value: l.id, label: l.name }))}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <KpiTile label="Opening Stock" value={formatNumber(report.summary.opening)} sublabel={report.summaryUom} />
        <KpiTile label="Received" value={formatNumber(report.summary.received)} sublabel={report.summaryUom} tone="healthy" />
        <KpiTile label="Consumed" value={formatNumber(report.summary.consumed)} sublabel={report.summaryUom} tone="warning" />
        <KpiTile label="Transferred (Net)" value={formatNumber(report.summary.transferIn - report.summary.transferOut)} sublabel={report.summaryUom} />
        <KpiTile label="Dispatched" value={formatNumber(report.summary.dispatched)} sublabel={report.summaryUom} tone="critical" />
        <KpiTile label="Adjustments" value={formatNumber(report.summary.adjustments)} sublabel={report.summaryUom} />
        <KpiTile label="Closing Stock" value={formatNumber(report.summary.closing)} sublabel={report.summaryUom} tone="healthy" />
      </div>
      {report.mixedUnits && (
        <p className="text-[11px] text-muted-soft">
          Summary above totals {report.summaryUom}-denominated materials only — materials measured in other units (e.g. packaged goods) are excluded from these totals but shown individually below.
        </p>
      )}

      <Panel
        title="Material-wise Summary"
        action={
          <ExportCsvButton
            filename="inventory-report.csv"
            headers={["Material", "Category", "UOM", "Opening Stock", "Received", "Consumed", "Transfer In", "Transfer Out", "Dispatched", "Adjustments", "Closing Stock"]}
            rows={report.materialRows.map((r) => [r.materialName, r.category.replace("_", " "), r.uom, formatNumber(r.opening), formatNumber(r.received), formatNumber(r.consumed), formatNumber(r.transferIn), formatNumber(r.transferOut), formatNumber(r.dispatched), formatNumber(r.adjustments), formatNumber(r.closing)])}
          />
        }
      >
        {report.materialRows.length === 0 ? (
          <EmptyState title="No materials match these filters" />
        ) : (
          <>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border-soft">
                    <Th>Material</Th>
                    <Th>Category</Th>
                    <Th className="text-right">Opening Stock</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">Consumed</Th>
                    <Th className="text-right">Transfer In</Th>
                    <Th className="text-right">Transfer Out</Th>
                    <Th className="text-right">Dispatched</Th>
                    <Th className="text-right">Adjustments</Th>
                    <Th className="text-right">Closing Stock</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.materialRows.map((r) => (
                    <tr key={r.materialId} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                      <Td>{r.materialName} <span className="text-xs text-muted-soft">({r.uom})</span></Td>
                      <Td className="text-xs text-muted">{r.category.replace("_", " ")}</Td>
                      <Td className="text-right tabular">{formatNumber(r.opening)}</Td>
                      <Td className="text-right tabular">{formatNumber(r.received)}</Td>
                      <Td className="text-right tabular">{formatNumber(r.consumed)}</Td>
                      <Td className="text-right tabular">{formatNumber(r.transferIn)}</Td>
                      <Td className="text-right tabular">{formatNumber(r.transferOut)}</Td>
                      <Td className="text-right tabular">{formatNumber(r.dispatched)}</Td>
                      <Td className="text-right tabular">{formatNumber(r.adjustments)}</Td>
                      <Td className="text-right tabular font-medium">{formatNumber(r.closing)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-muted-soft">
              Transfer In/Out can differ for material still mid-transit at the selected end date — the gap sits in the in-transit bucket, not lost stock.
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
