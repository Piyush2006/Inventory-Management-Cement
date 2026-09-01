import Link from "next/link";
import { prisma } from "@/lib/db";
import { Panel, Th, Td, EmptyState, LinkPill } from "@/components/ui";
import { formatNumber, formatDate } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";
import { FULFILMENT_ROLES } from "@/lib/domain/enums";
import { NewPoForm } from "./new-po-form";

export const dynamic = "force-dynamic";

const PO_STATUS_STYLE: Record<string, string> = {
  EXPECTED: "text-[var(--status-transit)] bg-[var(--status-transit-bg)]",
  PARTIALLY_RECEIVED: "text-[var(--status-warning)] bg-[var(--status-warning-bg)]",
  RECEIVED: "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]",
  CANCELLED: "text-muted bg-surface-raised",
};
const GRN_STATUS_STYLE: Record<string, string> = {
  DRAFT: "text-muted bg-surface-raised",
  POSTED: "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]",
  CANCELLED: "text-[var(--status-critical)] bg-[var(--status-critical-bg)]",
};

export default async function ReceiptsPage() {
  const [materials, suppliers, purchaseReferences, receipts, currentUser] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.purchaseReference.findMany({ where: { status: { not: "CANCELLED" } }, include: { supplier: true, material: true }, orderBy: { createdAt: "desc" } }),
    prisma.materialReceipt.findMany({ include: { supplier: true, material: true, destinationLocation: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    getCurrentUser(),
  ]);
  const canRecord = FULFILMENT_ROLES.includes(currentUser.role as "STORE_OPERATOR" | "INVENTORY_MANAGER");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Material Receipts (GRN)</h1>
          <p className="mt-1 text-sm text-muted">
            Incoming material flows through a Purchase/Source Reference, then a Material Receipt — inventory only
            increases by the <strong className="text-foreground">accepted</strong> quantity, once the GRN is posted.
          </p>
        </div>
        {canRecord && (
          <Link href="/receipts/new" className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
            + Receive Material
          </Link>
        )}
      </div>

      <Panel
        title="Purchase / Source References"
        action={canRecord ? <NewPoForm materials={materials.map((m) => ({ id: m.id, name: m.name, uom: m.uom }))} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} /> : undefined}
      >
        {purchaseReferences.length === 0 ? (
          <EmptyState title="No open purchase references" body="Create one before receiving, or receive material directly without a PO." />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>PO Number</Th>
                  <Th>Supplier</Th>
                  <Th>Material</Th>
                  <Th className="text-right">Ordered</Th>
                  <Th>Expected</Th>
                  <Th>Status</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {purchaseReferences.map((po) => (
                  <tr key={po.id} className="border-b border-border-soft last:border-0">
                    <Td className="text-xs text-muted-soft">{po.poNumber}</Td>
                    <Td>{po.supplier.name}</Td>
                    <Td>{po.material.name}</Td>
                    <Td className="text-right tabular">{formatNumber(po.orderedQuantity)} {po.material.uom}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : "—"}</Td>
                    <Td><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${PO_STATUS_STYLE[po.status]}`}>{po.status.replace("_", " ")}</span></Td>
                    <Td>
                      {canRecord && po.status !== "RECEIVED" && (
                        <LinkPill href={`/receipts/new?purchaseReferenceId=${po.id}`}>Receive →</LinkPill>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={`Receipt History (${receipts.length})`}>
        {receipts.length === 0 ? (
          <EmptyState title="No receipts recorded yet" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>GRN</Th>
                  <Th>Date</Th>
                  <Th>Supplier</Th>
                  <Th>Material</Th>
                  <Th className="text-right">Received</Th>
                  <Th className="text-right">Accepted</Th>
                  <Th className="text-right">Rejected</Th>
                  <Th>Location</Th>
                  <Th>Invoice</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className="border-b border-border-soft last:border-0">
                    <Td><Link href={`/receipts/${r.id}`} className="text-accent hover:underline">{r.grnNumber}</Link></Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDate(r.receiptDate)}</Td>
                    <Td className="text-xs text-muted">{r.supplier.name}</Td>
                    <Td>{r.material.name}</Td>
                    <Td className="text-right tabular">{formatNumber(r.receivedQuantity)}</Td>
                    <Td className="text-right tabular text-[var(--status-healthy)]">{formatNumber(r.acceptedQuantity)}</Td>
                    <Td className="text-right tabular text-[var(--status-critical)]">{formatNumber(r.rejectedQuantity)}</Td>
                    <Td className="text-xs text-muted">{r.destinationLocation.name}</Td>
                    <Td className="text-xs text-muted-soft">{r.invoiceNumber ?? "—"}</Td>
                    <Td><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${GRN_STATUS_STYLE[r.status]}`}>{r.status}</span></Td>
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
