import Link from "next/link";
import { Th, Td, EmptyState } from "@/components/ui";
import { formatNumber, formatDate } from "@/lib/format";
import { NewPoForm } from "@/app/receipts/new-po-form";

const GRN_STATUS_STYLE: Record<string, string> = {
  DRAFT: "text-muted bg-surface-raised",
  POSTED: "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]",
  CANCELLED: "text-[var(--status-critical)] bg-[var(--status-critical-bg)]",
};

type Receipt = {
  id: string;
  grnNumber: string;
  receiptDate: Date;
  supplierName: string;
  materialName: string;
  category: string;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  status: string;
};

export function ReceiveMaterialPanel({
  receipts,
  canRecord,
  materials,
  suppliers,
}: {
  receipts: Receipt[];
  canRecord: boolean;
  materials: { id: string; name: string; uom: string }[];
  suppliers: { id: string; name: string }[];
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-soft">
        External material entering the plant. Inventory increases by the <strong className="text-foreground">accepted</strong> quantity only, once the GRN is posted.
      </p>
      {canRecord && (
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/receipts/new" className="btn btn-primary btn-md">
            + Receive Material
          </Link>
          <NewPoForm materials={materials} suppliers={suppliers} />
        </div>
      )}

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
                <Th>Type</Th>
                <Th className="text-right">Received</Th>
                <Th className="text-right">Accepted</Th>
                <Th className="text-right">Rejected</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                  <Td><Link href={`/receipts/${r.id}`} className="text-accent hover:underline">{r.grnNumber}</Link></Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDate(r.receiptDate)}</Td>
                  <Td className="text-xs text-muted">{r.supplierName}</Td>
                  <Td>{r.materialName}</Td>
                  <Td className="text-xs text-muted">{r.category === "SPARE" ? "Spare" : "Material"}</Td>
                  <Td className="text-right tabular">{formatNumber(r.receivedQuantity)}</Td>
                  <Td className="text-right tabular text-[var(--status-healthy)]">{formatNumber(r.acceptedQuantity)}</Td>
                  <Td className="text-right tabular text-[var(--status-critical)]">{formatNumber(r.rejectedQuantity)}</Td>
                  <Td><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${GRN_STATUS_STYLE[r.status]}`}>{r.status}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
