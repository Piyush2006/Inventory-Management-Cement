import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Panel, KpiTile } from "@/components/ui";
import { formatNumber, formatDate, formatDateTime } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";
import { FULFILMENT_ROLES } from "@/lib/domain/enums";
import { ReceiptActions } from "./receipt-actions";

export const dynamic = "force-dynamic";

const GRN_STATUS_STYLE: Record<string, string> = {
  DRAFT: "text-muted bg-surface-raised",
  POSTED: "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]",
  CANCELLED: "text-[var(--status-critical)] bg-[var(--status-critical-bg)]",
};

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await prisma.materialReceipt.findUnique({
    where: { id },
    include: { supplier: true, material: true, destinationLocation: true, purchaseReference: true, stockRequest: true },
  });
  if (!receipt) notFound();

  const [inventoryTx, reversalTx, currentUser] = await Promise.all([
    receipt.inventoryTransactionId ? prisma.inventoryTransaction.findUnique({ where: { id: receipt.inventoryTransactionId } }) : null,
    receipt.reversalTransactionId ? prisma.inventoryTransaction.findUnique({ where: { id: receipt.reversalTransactionId } }) : null,
    getCurrentUser(),
  ]);
  const canRecord = FULFILMENT_ROLES.includes(currentUser.role as "STORE_OPERATOR" | "INVENTORY_MANAGER");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{receipt.grnNumber}</h1>
          <p className="mt-1 text-xs text-muted-soft">
            {receipt.material.name} &middot; {receipt.supplier.name} &middot; {formatDate(receipt.receiptDate)}
          </p>
        </div>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${GRN_STATUS_STYLE[receipt.status]}`}>{receipt.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Received" value={`${formatNumber(receipt.receivedQuantity)} ${receipt.material.uom}`} />
        <KpiTile label="Accepted" value={`${formatNumber(receipt.acceptedQuantity)} ${receipt.material.uom}`} tone="healthy" />
        <KpiTile label="Rejected" value={`${formatNumber(receipt.rejectedQuantity)} ${receipt.material.uom}`} tone={receipt.rejectedQuantity > 0 ? "warning" : "default"} />
        <KpiTile label="Ordered (at receipt)" value={receipt.orderedQuantitySnapshot != null ? formatNumber(receipt.orderedQuantitySnapshot) : "—"} />
      </div>

      <Panel title="Actions">
        {canRecord ? (
          <ReceiptActions id={receipt.id} status={receipt.status} />
        ) : (
          <p className="text-sm text-muted-soft">
            Your role ({currentUser.role}) cannot post or cancel receipts — this requires Store/Inventory Operator or Inventory Manager.
          </p>
        )}
      </Panel>

      <Panel title="Source">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Supplier" value={receipt.supplier.name} />
          <Row label="Purchase Reference" value={receipt.purchaseReference ? <Link href="/receipts" className="text-accent hover:underline">{receipt.purchaseReference.poNumber}</Link> : "None — direct receipt"} />
          <Row label="Destination Location" value={receipt.destinationLocation.name} />
          <Row label="Batch / Lot" value={receipt.batchLot ?? "—"} />
          <Row label="Stock Request" value={receipt.stockRequest ? receipt.stockRequest.requestNumber : "—"} />
        </dl>
      </Panel>

      <Panel title="Invoice & Delivery Documents">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Invoice / Bill Number" value={receipt.invoiceNumber ?? "—"} />
          <Row label="Invoice Date" value={receipt.invoiceDate ? formatDate(receipt.invoiceDate) : "—"} />
          <Row label="Invoice Amount" value={receipt.invoiceAmount != null ? formatNumber(receipt.invoiceAmount, 2) : "—"} />
          <Row label="Delivery Note" value={receipt.deliveryNoteNumber ?? "—"} />
          <Row label="Supplier Challan" value={receipt.supplierChallan ?? "—"} />
          <Row label="Vehicle Reference" value={receipt.vehicleReference ?? "—"} />
          <Row label="Truck Number" value={receipt.truckNumber ?? "—"} />
        </dl>
        {receipt.notes && <p className="mt-3 text-sm text-muted">{receipt.notes}</p>}
      </Panel>

      <Panel title="Ledger Linkage">
        {inventoryTx ? (
          <div className="rounded-md border border-border-soft bg-surface-raised px-3 py-2 text-sm">
            <span className="text-foreground">{inventoryTx.transactionType}</span> +{formatNumber(inventoryTx.quantity)} {inventoryTx.uom} — {formatDateTime(inventoryTx.timestamp)}
          </div>
        ) : (
          <p className="text-sm text-muted-soft">Not posted yet — no ledger entry exists for this receipt.</p>
        )}
        {reversalTx && (
          <div className="mt-2 rounded-md border border-[var(--status-critical)]/25 bg-[var(--status-critical-bg)] px-3 py-2 text-sm">
            Reversal: {reversalTx.transactionType} −{formatNumber(reversalTx.quantity)} {reversalTx.uom} — {formatDateTime(reversalTx.timestamp)}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </>
  );
}
