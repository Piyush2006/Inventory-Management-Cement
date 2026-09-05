"use client";

import { useState } from "react";
import { CountAdjustForm } from "./count-adjust-form";
import { ReceiveMaterialPanel } from "./receive-material-panel";
import { DispatchPanel } from "./dispatch-panel";
import { PendingCountsPanel } from "./pending-counts-panel";
import { SpareReturnPanel } from "./spare-return-panel";
import { Modal } from "@/components/modal";
import { Th, Td, EmptyState } from "@/components/ui";
import { formatNumber, formatDateTime } from "@/lib/format";

type Material = { id: string; name: string; uom: string };
type Location = { id: string; name: string };
type BalanceRow = { materialId: string; materialName: string; uom: string; locationId: string; locationName: string; quantity: number; unrestrictedQuantity: number; tolerancePct: number };
type Receipt = {
  id: string; grnNumber: string; receiptDate: Date; supplierName: string; materialName: string; category: string;
  receivedQuantity: number; acceptedQuantity: number; rejectedQuantity: number; status: string;
};
type DispatchRow = {
  id: string; dispatchReference: string; materialId: string; materialName: string; category: string; uom: string; quantity: number;
  sourceLocationId: string; sourceLocationName: string; customerDestination: string; status: string;
  assignedToName: string | null; createdAt: Date;
};
type MovementRow = {
  id: string; timestamp: Date; materialName: string; category: string; uom: string; quantity: number;
  fromLocationName: string | null; toLocationName: string | null; reference: string | null;
};
type PendingCount = {
  id: string; materialName: string; uom: string; locationName: string; bookQuantity: number;
  countedQuantity: number; tolerancePct: number; countedBy: string; note: string | null;
};
type SpareRequestOption = { id: string; requestNumber: string; materialId: string; issued: number; alreadyReturned: number };
type SpareReturnRow = {
  id: string; returnReference: string; originalIssueReference: string; materialId: string; materialName: string; uom: string; quantity: number;
  status: string; returnedBy: string; reportedByName: string; reason: string | null; condition: string | null; locationName: string | null; processedByName: string | null; createdAt: Date;
};

const TABS: { key: "RECEIVE" | "ADJUSTMENT" | "DISPATCH" | "SPARE_RETURN"; label: string }[] = [
  { key: "RECEIVE", label: "Receive Material" },
  { key: "ADJUSTMENT", label: "Adjustment" },
  { key: "DISPATCH", label: "Dispatch" },
  { key: "SPARE_RETURN", label: "Spare Return" },
];

// Each tab owns its own history — no list mixes movements from a different tab's transaction type.
function RecentMovementsList({ rows, emptyLabel }: { rows: MovementRow[]; emptyLabel: string }) {
  if (rows.length === 0) return <EmptyState title={emptyLabel} />;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border-soft">
            <Th>Timestamp</Th>
            <Th>Material</Th>
            <Th>Type</Th>
            <Th className="text-right">Quantity</Th>
            <Th>From</Th>
            <Th>To</Th>
            <Th>Reference / Reason</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
              <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(m.timestamp)}</Td>
              <Td>{m.materialName}</Td>
              <Td className="text-xs text-muted">{m.category === "SPARE" ? "Spare" : "Material"}</Td>
              <Td className="text-right tabular">{formatNumber(m.quantity)} {m.uom}</Td>
              <Td className="text-xs text-muted">{m.fromLocationName ?? "—"}</Td>
              <Td className="text-xs text-muted">{m.toLocationName ?? "—"}</Td>
              <Td className="text-xs text-muted-soft">{m.reference ?? "—"}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MovementTabs({
  materials,
  locations,
  balances,
  receipts,
  suppliers,
  canRecord,
  canRecordAdjustment,
  canCompleteSpareReturn,
  canViewSpareReturns,
  dispatches,
  canCreateDispatch,
  canAccessDispatch,
  adjustmentMovements,
  pendingCounts,
  canApprove,
  spareMaterials,
  spareRequests,
  spareReturns,
  initialTab,
}: {
  materials: Material[];
  locations: Location[];
  balances: BalanceRow[];
  receipts: Receipt[];
  suppliers: { id: string; name: string }[];
  canRecord: boolean;
  canRecordAdjustment: boolean;
  canCompleteSpareReturn: boolean;
  canViewSpareReturns: boolean;
  dispatches: DispatchRow[];
  canCreateDispatch: boolean;
  canAccessDispatch: boolean;
  adjustmentMovements: MovementRow[];
  pendingCounts: PendingCount[];
  canApprove: boolean;
  spareMaterials: Material[];
  spareRequests: SpareRequestOption[];
  spareReturns: SpareReturnRow[];
  // Lets an external link (the Dashboard's "Your Actions" queue) land directly on the tab its
  // action lives on, e.g. /movements?tab=ADJUSTMENT — purely a UI preselection, no new logic.
  initialTab?: (typeof TABS)[number]["key"];
}) {
  // Store Supervisor reaches this page now solely for Dispatch, plus the Adjustment tab's
  // physical-count step and read-only Spare Return monitoring — Receive Material stays hidden
  // for anyone canRecord doesn't cover.
  const visibleTabs = TABS.filter((t) =>
    t.key === "DISPATCH" ? canAccessDispatch : t.key === "ADJUSTMENT" ? canRecordAdjustment : t.key === "SPARE_RETURN" ? canViewSpareReturns : canRecord
  );
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(
    initialTab && visibleTabs.some((t) => t.key === initialTab) ? initialTab : visibleTabs[0]?.key ?? "DISPATCH"
  );
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTab(t.key); setFormOpen(false); }}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              tab === t.key ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "RECEIVE" ? (
        <ReceiveMaterialPanel receipts={receipts} canRecord={canRecord} materials={materials} suppliers={suppliers} />
      ) : tab === "ADJUSTMENT" ? (
        <div key="adjustment" className="space-y-6">
          <div className="flex justify-end">
            <button type="button" onClick={() => setFormOpen(true)} className="btn btn-primary btn-sm">
              + Record Count &amp; Adjustment
            </button>
          </div>
          <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Record Count &amp; Adjustment">
            <CountAdjustForm balances={balances} />
          </Modal>
          {pendingCounts.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                Pending Approval ({pendingCounts.length}){!canApprove && " — view only"}
              </h3>
              <PendingCountsPanel counts={pendingCounts} canApprove={canApprove} />
            </div>
          )}
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Recent Adjustments</h3>
            <RecentMovementsList rows={adjustmentMovements} emptyLabel="No adjustments posted yet" />
          </div>
        </div>
      ) : tab === "DISPATCH" ? (
        <DispatchPanel dispatches={dispatches} materials={materials} locations={locations} balances={balances} canCreate={canCreateDispatch} />
      ) : (
        <SpareReturnPanel
          materials={spareMaterials}
          locations={locations}
          requests={spareRequests}
          returns={spareReturns}
          canComplete={canCompleteSpareReturn}
        />
      )}
    </div>
  );
}
