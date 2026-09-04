import Link from "next/link";
import { prisma } from "@/lib/db";
import { Panel, Th, Td, EmptyState } from "@/components/ui";
import { ExportCsvButton } from "@/components/export-csv-button";
import { formatNumber, formatDateTime } from "@/lib/format";
import { TRANSACTION_TYPES } from "@/lib/domain/enums";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// No restrictToRequestsOnly gate — Indentor (Requester) has full read access; this is a
// read-only ledger view, no write action lives here.
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ materialId?: string; type?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const materials = await prisma.material.findMany({ orderBy: { name: "asc" } });

  const where: Prisma.InventoryTransactionWhereInput = {};
  if (params.materialId) where.materialId = params.materialId;
  if (params.type) where.transactionType = params.type;
  if (params.from || params.to) {
    where.timestamp = {
      ...(params.from ? { gte: new Date(params.from) } : {}),
      ...(params.to ? { lte: new Date(`${params.to}T23:59:59`) } : {}),
    };
  }

  const LEDGER_ROW_LIMIT = 100;
  const transactions = await prisma.inventoryTransaction.findMany({
    where,
    include: { material: true, sourceLocation: true, destinationLocation: true },
    orderBy: { timestamp: "desc" },
    take: LEDGER_ROW_LIMIT,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Ledger</h1>
        <p className="mt-1 text-sm text-muted">The source of truth for every stock change. Showing the most recent {LEDGER_ROW_LIMIT} matching movements — narrow the filters below to see further back.</p>
      </div>

      <Panel title="Filters">
        <form className="grid grid-cols-2 gap-3 sm:grid-cols-4" method="GET">
          <label className="text-xs text-muted">
            Material
            <select name="materialId" defaultValue={params.materialId ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              <option value="">All materials</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Type
            <select name="type" defaultValue={params.type ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              <option value="">All types</option>
              {TRANSACTION_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace("_", " ")}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            From
            <input type="date" name="from" defaultValue={params.from ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            To
            <input type="date" name="to" defaultValue={params.to ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <div className="col-span-2 flex items-end gap-2 sm:col-span-4">
            <button type="submit" className="btn btn-primary btn-sm">Apply</button>
            <Link href="/ledger" className="btn btn-secondary btn-sm">Clear</Link>
          </div>
        </form>
      </Panel>

      <Panel
        title={`Movements (${transactions.length})`}
        action={
          <ExportCsvButton
            filename="ledger.csv"
            headers={["Timestamp", "Type", "Material", "Material Type", "Quantity", "UOM", "From", "To", "Reference", "Batch/Lot", "Reason"]}
            rows={transactions.map((t) => [
              formatDateTime(t.timestamp),
              t.transactionType,
              t.material.name,
              t.material.category === "SPARE" ? "Spare" : "Material",
              formatNumber(t.quantity),
              t.uom,
              t.sourceLocation?.name ?? "",
              t.destinationLocation?.name ?? "",
              t.reference ?? "",
              t.batchLot ?? "",
              t.reason ?? t.processName ?? "",
            ])}
          />
        }
      >
        {transactions.length === 0 ? (
          <EmptyState title="No movements match these filters" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Timestamp</Th>
                  <Th>Type</Th>
                  <Th>Material</Th>
                  <Th>Material Type</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th>Reference</Th>
                  <Th>Batch/Lot</Th>
                  <Th>Reason / Note</Th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(t.timestamp)}</Td>
                    <Td className="text-xs text-muted">{t.transactionType.replace("_", " ")}</Td>
                    <Td>{t.material.name}</Td>
                    <Td className="text-xs text-muted">{t.material.category === "SPARE" ? "Spare" : "Material"}</Td>
                    <Td className="text-right tabular">{formatNumber(t.quantity)} {t.uom}</Td>
                    <Td className="text-xs text-muted">{t.sourceLocation?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted">{t.destinationLocation?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted-soft">{t.reference ?? "—"}</Td>
                    <Td className="text-xs text-muted-soft">{t.batchLot ?? "—"}</Td>
                    <Td className="text-xs text-muted-soft">{t.reason ?? t.processName ?? "—"}</Td>
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
