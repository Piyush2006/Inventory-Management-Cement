import { prisma } from "@/lib/db";
import { Panel, Th, Td, EmptyState } from "@/components/ui";
import { ExportCsvButton } from "@/components/export-csv-button";
import { ReportFilterBar } from "./report-filter-bar";
import { getDispatchReport } from "@/lib/reports/requestDispatch";
import { formatNumber, formatDate } from "@/lib/format";
import { DISPATCH_STATUSES } from "@/lib/domain/enums";
import { parseDateRangeParams } from "@/lib/reports/types";

export async function DispatchReportSection({
  params,
  currentUser,
}: {
  params: Record<string, string | undefined>;
  currentUser: { id: string; role: string };
}) {
  const materials = await prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  const { from, to } = parseDateRangeParams(params.from, params.to);
  const filters = { from, to, materialId: params.materialId, status: params.status, reference: params.reference, userId: params.userId, category: params.category };
  // Store Operator only ever sees its own assigned dispatches anywhere else in the app
  // (movements/page.tsx scopes the Dispatch fetch itself, not just which actions render) —
  // Reports mirrors that, not a wider default.
  const scopeToUserId = currentUser.role === "STORE_OPERATOR" ? currentUser.id : undefined;

  const report = await getDispatchReport(filters, scopeToUserId);

  return (
    <div className="space-y-4">
      <ReportFilterBar
        tab="dispatch"
        fields={["dateRange", "material", "status", "reference", "user", "category"]}
        params={params}
        materials={materials.map((m) => ({ value: m.id, label: m.name }))}
        locations={[]}
        statusOptions={DISPATCH_STATUSES.map((s) => ({ value: s, label: s }))}
        users={users.map((u) => ({ value: u.id, label: u.name }))}
      />

      <Panel
        title={`Dispatches (${report.rows.length})`}
        action={
          <ExportCsvButton
            filename="dispatch-report.csv"
            headers={["Dispatch ID", "Material", "Category", "Quantity", "Destination", "Status", "Created Date", "Dispatched Date"]}
            rows={report.rows.map((d) => [d.dispatchReference, d.materialName, d.category.replace("_", " "), formatNumber(d.quantity), d.customerDestination, d.status, formatDate(d.createdAt), d.dispatchedAt ? formatDate(d.dispatchedAt) : ""])}
          />
        }
      >
        {report.rows.length === 0 ? (
          <EmptyState title="No dispatches match these filters" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Dispatch ID</Th>
                  <Th>Material</Th>
                  <Th>Category</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th>Destination</Th>
                  <Th>Status</Th>
                  <Th>Created Date</Th>
                  <Th>Dispatched Date</Th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((d) => (
                  <tr key={d.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                    <Td className="text-xs text-muted-soft">{d.dispatchReference}</Td>
                    <Td>{d.materialName}</Td>
                    <Td className="text-xs text-muted">{d.category.replace("_", " ")}</Td>
                    <Td className="text-right tabular">{formatNumber(d.quantity)} {d.uom}</Td>
                    <Td className="text-xs text-muted">{d.customerDestination}</Td>
                    <Td className="text-xs text-muted">{d.status}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDate(d.createdAt)}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{d.dispatchedAt ? formatDate(d.dispatchedAt) : "—"}</Td>
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
