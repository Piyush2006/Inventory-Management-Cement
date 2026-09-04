"use client";

import { useState, useTransition } from "react";
import { Th, Td, EmptyState } from "@/components/ui";
import { Modal } from "@/components/modal";
import { SpareReturnForm } from "./spare-return-form";
import { actionCompleteSpareReturn } from "@/app/actions";
import { RETURN_CONDITIONS } from "@/lib/domain/enums";
import { formatNumber, formatDateTime } from "@/lib/format";

type Material = { id: string; name: string; uom: string };
type Location = { id: string; name: string };
type SpareRequestOption = { id: string; requestNumber: string; materialId: string; issued: number; alreadyReturned: number };
type SpareReturnRow = {
  id: string;
  returnReference: string;
  originalIssueReference: string;
  materialId: string;
  materialName: string;
  uom: string;
  quantity: number;
  status: string;
  returnedBy: string;
  reportedByName: string;
  reason: string | null;
  condition: string | null;
  locationName: string | null;
  processedByName: string | null;
  createdAt: Date;
};

const USABLE_CONDITIONS = ["UNUSED", "SERVICEABLE"];

// Store Operator/Admin's stage-2 action on a reported-but-not-completed return: pick the
// receiving location and record the verified condition. Posting only happens here — the
// report itself (whoever created this row) never touched inventory.
function CompleteReturnRow({ row, locations }: { row: SpareReturnRow; locations: Location[] }) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [condition, setCondition] = useState<(typeof RETURN_CONDITIONS)[number]>("UNUSED");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  function submit() {
    setResult(null);
    const fd = new FormData();
    fd.set("spareReturnId", row.id);
    fd.set("locationId", locationId);
    fd.set("condition", condition);
    startTransition(async () => setResult(await actionCompleteSpareReturn(fd)));
  }

  return (
    <div className="rounded-md border border-border-soft bg-surface-raised p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-foreground">{row.materialName} — {formatNumber(row.quantity)} {row.uom}</div>
        <span className="text-xs text-muted-soft">{row.originalIssueReference}</span>
      </div>
      <div className="mt-1 text-[11px] text-muted-soft">Reported by {row.reportedByName} — {formatDateTime(row.createdAt)}{row.reason ? ` — ${row.reason}` : ""}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="text-xs text-muted">
          Receiving location
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent">
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Verified condition
          <select value={condition} onChange={(e) => setCondition(e.target.value as (typeof RETURN_CONDITIONS)[number])} className="mt-1 block w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent">
            {RETURN_CONDITIONS.map((c) => (
              <option key={c} value={c}>{c.replace("_", " ")}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" onClick={submit} disabled={pending || !locationId} className="btn btn-primary btn-xs w-full">
            {pending ? "Completing…" : "Complete Return"}
          </button>
        </div>
      </div>
      {result && !result.ok && <div className="mt-1 text-xs text-[var(--status-critical)]">{result.error}</div>}
    </div>
  );
}

export function SpareReturnPanel({
  materials,
  locations,
  requests,
  returns,
  canComplete,
}: {
  materials: Material[];
  locations: Location[];
  requests: SpareRequestOption[];
  returns: SpareReturnRow[];
  canComplete: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const pending = returns.filter((r) => r.status === "REPORTED");
  const history = returns.filter((r) => r.status === "COMPLETED");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-soft">Spares returned to Store against a previously issued spare request.</p>
        {canComplete && (
          <button type="button" onClick={() => { setCreating(true); setLastSaved(null); }} className="btn btn-secondary btn-sm">
            + Add Return
          </button>
        )}
      </div>

      {lastSaved && !creating && (
        <div className="rounded-md border border-[var(--status-healthy)]/30 bg-[var(--status-healthy-bg)] px-3 py-2 text-sm text-[var(--status-healthy)]">
          Return {lastSaved} recorded.
        </div>
      )}

      {canComplete && (
        <Modal open={creating} onClose={() => setCreating(false)} title="Add Spare Return">
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
        </Modal>
      )}

      {pending.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Pending Returns ({pending.length}){!canComplete && " — view only"}
          </h3>
          {canComplete ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {pending.map((r) => (
                <CompleteReturnRow key={r.id} row={r} locations={locations} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {pending.map((r) => (
                <div key={r.id} className="rounded-md border border-border-soft bg-surface-raised p-3 text-sm">
                  <div className="text-foreground">{r.materialName} — {formatNumber(r.quantity)} {r.uom}</div>
                  <div className="mt-1 text-[11px] text-muted-soft">{r.originalIssueReference} — reported by {r.reportedByName} — awaiting Store Operator</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        {history.length > 0 && <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">History</h3>}
        {history.length === 0 ? (
          <EmptyState title="No spare returns completed yet" />
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
                {history.map((r) => {
                  const usable = USABLE_CONDITIONS.includes(r.condition ?? "");
                  return (
                    <tr key={r.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                      <Td className="text-xs text-muted-soft">{r.returnReference}</Td>
                      <Td className="text-xs text-muted">{r.originalIssueReference}</Td>
                      <Td>{r.materialName}</Td>
                      <Td className="text-right tabular">{formatNumber(r.quantity)} {r.uom}</Td>
                      <Td className="text-xs text-muted">{r.returnedBy}</Td>
                      <Td className="text-xs text-muted">{r.condition?.replace("_", " ") ?? "—"}</Td>
                      <Td className="text-xs text-muted">{r.locationName ?? "—"}</Td>
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
    </div>
  );
}
