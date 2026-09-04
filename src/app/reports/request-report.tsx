import { prisma } from "@/lib/db";
import { Panel, Th, Td, EmptyState } from "@/components/ui";
import { ExportCsvButton } from "@/components/export-csv-button";
import { ReportFilterBar } from "./report-filter-bar";
import { getRequestReport } from "@/lib/reports/requestDispatch";
import { formatNumber, formatDate } from "@/lib/format";
import { REQUEST_STATUSES } from "@/lib/domain/enums";
import { parseDateRangeParams } from "@/lib/reports/types";

export async function RequestReportSection({
  params,
  currentUser,
}: {
  params: Record<string, string | undefined>;
  currentUser: { id: string; role: string };
}) {
  const materials = await prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  const { from, to } = parseDateRangeParams(params.from, params.to);
  const filters = { from, to, materialId: params.materialId, status: params.status, reference: params.reference, userId: params.userId };
  // Store Operator only ever sees its own assigned requests anywhere else in the app
  // (requests/page.tsx's Open/History tabs are scoped to assignedToUserId, not just actions) —
  // Reports mirrors that, not a wider default. Indentor (Requester) is scoped the same way to
  // the requests they themselves raised — a production requisitioner doesn't need visibility
  // into every other requester's requests network-wide.
  const scopeToUserId = currentUser.role === "STORE_OPERATOR" || currentUser.role === "REQUESTER" ? currentUser.id : undefined;
  const scopeField = currentUser.role === "REQUESTER" ? ("requestedByUserId" as const) : ("assignedToUserId" as const);

  const report = await getRequestReport(filters, scopeToUserId, scopeField);

  return (
    <div className="space-y-4">
      <ReportFilterBar
        tab="request"
        fields={["dateRange", "material", "status", "reference", "user"]}
        params={params}
        materials={materials.map((m) => ({ value: m.id, label: m.name }))}
        locations={[]}
        statusOptions={REQUEST_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))}
        users={users.map((u) => ({ value: u.id, label: u.name }))}
      />

      <Panel
        title={`Requests (${report.rows.length})`}
        action={
          <ExportCsvButton
            filename="request-report.csv"
            headers={["Request ID", "Material", "Requested Qty", "Delivered Qty", "Received Qty", "Remaining Qty", "Status", "Requested By", "Assigned To", "Requested Date", "Accepted Date", "Assigned Date", "In Transit Date", "Delivered Date", "Completed Date"]}
            rows={report.rows.map((r) => [
              r.requestNumber, r.materialName, formatNumber(r.quantityRequested), formatNumber(r.deliveredQuantity), formatNumber(r.receivedQuantity), formatNumber(r.remainingQuantity),
              r.status, r.requestedByName, r.assignedToName ?? "",
              formatDate(r.requestedAt), r.acceptedAt ? formatDate(r.acceptedAt) : "", r.assignedAt ? formatDate(r.assignedAt) : "",
              r.inTransitAt ? formatDate(r.inTransitAt) : "", r.deliveredAt ? formatDate(r.deliveredAt) : "", r.completedAt ? formatDate(r.completedAt) : "",
            ])}
          />
        }
      >
        {report.rows.length === 0 ? (
          <EmptyState title="No requests match these filters" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Request ID</Th>
                  <Th>Material</Th>
                  <Th className="text-right">Requested</Th>
                  <Th className="text-right">Delivered</Th>
                  <Th className="text-right">Received</Th>
                  <Th className="text-right">Remaining</Th>
                  <Th>Status</Th>
                  <Th>Requested By</Th>
                  <Th>Assigned To</Th>
                  <Th>Requested Date</Th>
                  <Th>Accepted Date</Th>
                  <Th>Assigned Date</Th>
                  <Th>In Transit Date</Th>
                  <Th>Delivered Date</Th>
                  <Th>Completed Date</Th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border-soft last:border-0">
                    <Td className="text-xs text-muted-soft">{r.requestNumber}</Td>
                    <Td>{r.materialName}</Td>
                    <Td className="text-right tabular">{formatNumber(r.quantityRequested)} {r.uom}</Td>
                    <Td className="text-right tabular">{formatNumber(r.deliveredQuantity)} {r.uom}</Td>
                    <Td className="text-right tabular">{formatNumber(r.receivedQuantity)} {r.uom}</Td>
                    <Td className="text-right tabular">{formatNumber(r.remainingQuantity)} {r.uom}</Td>
                    <Td className="text-xs text-muted">{r.status.replace("_", " ")}</Td>
                    <Td className="text-xs text-muted">{r.requestedByName}</Td>
                    <Td className="text-xs text-muted">{r.assignedToName ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDate(r.requestedAt)}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{r.acceptedAt ? formatDate(r.acceptedAt) : "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{r.assignedAt ? formatDate(r.assignedAt) : "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{r.inTransitAt ? formatDate(r.inTransitAt) : "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{r.deliveredAt ? formatDate(r.deliveredAt) : "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{r.completedAt ? formatDate(r.completedAt) : "—"}</Td>
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
