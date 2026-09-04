import Link from "next/link";
import { prisma } from "@/lib/db";
import { Panel, Th, Td, EmptyState } from "@/components/ui";
import { ExportCsvButton } from "@/components/export-csv-button";
import { ReportFilterBar } from "./report-filter-bar";
import { getStockMovementReport, getStockMovementReportForExport } from "@/lib/reports/stockMovement";
import { OPERATION_GROUPS, operationLabelForType } from "@/lib/reports/operations";
import { formatNumber, formatDateTime } from "@/lib/format";
import { IN_TRANSIT_LOCATION_TYPE } from "@/lib/domain/enums";
import { parseDateRangeParams } from "@/lib/reports/types";

function buildPageHref(params: Record<string, string | undefined>, page: number) {
  const usp = new URLSearchParams();
  usp.set("tab", "movement");
  for (const [k, v] of Object.entries(params)) if (v) usp.set(k, v);
  usp.set("page", String(page));
  return `/reports?${usp.toString()}`;
}

export async function StockMovementReportSection({ params }: { params: Record<string, string | undefined> }) {
  const [materials, locations, users] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const { from, to } = parseDateRangeParams(params.from, params.to);
  const filters = { from, to, materialId: params.materialId, locationId: params.locationId, operation: params.operation, reference: params.reference, userId: params.userId, category: params.category };
  const page = Math.max(1, Number(params.page) || 1);
  const [report, exportRows] = await Promise.all([
    getStockMovementReport(filters, page),
    getStockMovementReportForExport(filters),
  ]);

  return (
    <div className="space-y-4">
      <ReportFilterBar
        tab="movement"
        fields={["dateRange", "material", "location", "operation", "reference", "user", "category"]}
        params={params}
        materials={materials.map((m) => ({ value: m.id, label: m.name }))}
        locations={locations.map((l) => ({ value: l.id, label: l.name }))}
        operationOptions={OPERATION_GROUPS.map((g) => ({ value: g.key, label: g.label }))}
        users={users.map((u) => ({ value: u.id, label: u.name }))}
      />

      <Panel
        title={`Transaction Details (${report.totalCount})`}
        action={
          <ExportCsvButton
            filename="stock-movement.csv"
            headers={["Date", "Material", "Category", "Operation", "Quantity", "UOM", "From Location", "To Location", "Reference", "User"]}
            rows={exportRows.map((r) => [formatDateTime(r.timestamp), r.materialName, r.category.replace("_", " "), operationLabelForType(r.transactionType), formatNumber(r.quantity), r.uom, r.fromLocationName ?? "", r.toLocationName ?? "", r.reference ?? "", r.userName ?? ""])}
          />
        }
      >
        {report.rows.length === 0 ? (
          <EmptyState title="No movements match these filters" />
        ) : (
          <>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border-soft">
                    <Th>Date</Th>
                    <Th>Material</Th>
                    <Th>Category</Th>
                    <Th>Operation</Th>
                    <Th className="text-right">Quantity</Th>
                    <Th>From Location</Th>
                    <Th>To Location</Th>
                    <Th>Reference</Th>
                    <Th>User</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                      <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(r.timestamp)}</Td>
                      <Td>{r.materialName}</Td>
                      <Td className="text-xs text-muted">{r.category.replace("_", " ")}</Td>
                      <Td className="text-xs text-muted">{operationLabelForType(r.transactionType)}</Td>
                      <Td className="text-right tabular">{formatNumber(r.quantity)} {r.uom}</Td>
                      <Td className="text-xs text-muted">{r.fromLocationName ?? "—"}</Td>
                      <Td className="text-xs text-muted">{r.toLocationName ?? "—"}</Td>
                      <Td className="text-xs text-muted-soft">{r.reference ?? "—"}</Td>
                      <Td className="text-xs text-muted-soft">{r.userName ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-muted">
              <span>
                Showing {(page - 1) * report.pageSize + 1}–{Math.min(page * report.pageSize, report.totalCount)} of {report.totalCount} transactions
              </span>
              <div className="flex items-center gap-1.5">
                {page > 1 ? (
                  <Link href={buildPageHref(params, page - 1)} className="btn btn-secondary btn-xs">←</Link>
                ) : (
                  <span className="rounded-md border border-border-soft px-2.5 py-1 opacity-40">←</span>
                )}
                <span className="px-2">Page {page} of {report.totalPages}</span>
                {page < report.totalPages ? (
                  <Link href={buildPageHref(params, page + 1)} className="btn btn-secondary btn-xs">→</Link>
                ) : (
                  <span className="rounded-md border border-border-soft px-2.5 py-1 opacity-40">→</span>
                )}
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
