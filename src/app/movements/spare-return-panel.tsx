"use client";

import { useState } from "react";
import { Th, Td, EmptyState } from "@/components/ui";
import { SpareReturnForm } from "./spare-return-form";
import { formatNumber, formatDateTime } from "@/lib/format";

type Material = { id: string; name: string; uom: string };
type Location = { id: string; name: string };
type SpareRequestOption = { id: string; requestNumber: string; materialId: string; issued: number; alreadyReturned: number };
type SpareReturnRow = {
  id: string;
  returnReference: string;
  originalIssueReference: string;
  materialName: string;
  uom: string;
  quantity: number;
  returnedBy: string;
  condition: string;
  locationName: string;
  processedByName: string;
  createdAt: Date;
};

const USABLE_CONDITIONS = ["UNUSED", "SERVICEABLE"];

export function SpareReturnPanel({
  materials,
  locations,
  requests,
  returns,
}: {
  materials: Material[];
  locations: Location[];
  requests: SpareRequestOption[];
  returns: SpareReturnRow[];
}) {
  const [creating, setCreating] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-soft">Spares returned to Store against a previously issued spare request.</p>
        <button type="button" onClick={() => { setCreating((v) => !v); setLastSaved(null); }} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground">
          {creating ? "Close" : "+ Add Return"}
        </button>
      </div>

      {lastSaved && !creating && (
        <div className="rounded-md border border-[var(--status-healthy)]/30 bg-[var(--status-healthy-bg)] px-3 py-2 text-sm text-[var(--status-healthy)]">
          Return {lastSaved} recorded.
        </div>
      )}

      {creating && (
        <SpareReturnForm
          materials={materials}
          locations={locations}
          requests={requests}
          onDone={(returnReference) => {
            setCreating(false);
            setLastSaved(returnReference);
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {returns.length === 0 ? (
        <EmptyState title="No spare returns recorded yet" />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-soft">
                <Th>Return Ref</Th>
                <Th>Original Issue</Th>
                <Th>Spare</Th>
                <Th className="text-right">Qty</Th>
                <Th>Returned By</Th>
                <Th>Condition</Th>
                <Th>Location</Th>
                <Th>Status</Th>
                <Th>Date</Th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => {
                const usable = USABLE_CONDITIONS.includes(r.condition);
                return (
                  <tr key={r.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                    <Td className="text-xs text-muted-soft">{r.returnReference}</Td>
                    <Td className="text-xs text-muted">{r.originalIssueReference}</Td>
                    <Td>{r.materialName}</Td>
                    <Td className="text-right tabular">{formatNumber(r.quantity)} {r.uom}</Td>
                    <Td className="text-xs text-muted">{r.returnedBy}</Td>
                    <Td className="text-xs text-muted">{r.condition.replace("_", " ")}</Td>
                    <Td className="text-xs text-muted">{r.locationName}</Td>
                    <Td>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${usable ? "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]" : "text-muted bg-surface-raised"}`}>
                        {usable ? "Usable" : "Not Usable"}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(r.createdAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
