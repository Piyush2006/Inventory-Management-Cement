"use client";

import { useMemo, useState, useTransition } from "react";
import { actionPostSpareReturn } from "@/app/actions";
import { RETURN_CONDITIONS } from "@/lib/domain/enums";
import { formatNumber } from "@/lib/format";

type Material = { id: string; name: string; uom: string };
type Location = { id: string; name: string };
type SpareRequestOption = { id: string; requestNumber: string; materialId: string; issued: number; alreadyReturned: number };

export function SpareReturnForm({
  materials,
  locations,
  requests,
  onDone,
  onCancel,
}: {
  materials: Material[];
  locations: Location[];
  requests: SpareRequestOption[];
  onDone: (returnReference: string) => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? "");
  const [requestId, setRequestId] = useState("");
  const [quantity, setQuantity] = useState("");

  const relevantRequests = useMemo(() => requests.filter((r) => r.materialId === materialId), [requests, materialId]);
  const selectedRequest = relevantRequests.find((r) => r.id === requestId);
  const material = materials.find((m) => m.id === materialId);
  const remaining = selectedRequest ? selectedRequest.issued - selectedRequest.alreadyReturned : null;

  return (
    <form
      className="space-y-3"
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          const res = await actionPostSpareReturn(fd);
          if (!res.ok) setError(res.error);
          else onDone(res.returnReference);
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="text-xs text-muted">
          Spare
          <select
            name="materialId"
            value={materialId}
            onChange={(e) => {
              setMaterialId(e.target.value);
              setRequestId("");
            }}
            className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            {materials.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Original Issue
          <select
            name="requestId"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            <option value="">Select…</option>
            {relevantRequests.map((r) => (
              <option key={r.id} value={r.id}>
                {r.requestNumber} ({formatNumber(r.issued - r.alreadyReturned)} {material?.uom ?? ""} remaining)
              </option>
            ))}
          </select>
          {relevantRequests.length === 0 && <span className="mt-1 block text-[11px] text-muted-soft">No outstanding issues on record for this spare.</span>}
        </label>
        <label className="text-xs text-muted">
          Return to location
          <select name="locationId" defaultValue={locations[0]?.id ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Quantity {remaining != null && <span className="text-muted-soft">({formatNumber(remaining)} {material?.uom} remaining)</span>}
          <input
            name="quantity"
            type="number"
            step="any"
            min="0.01"
            max={remaining ?? undefined}
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="text-xs text-muted">
          Condition
          <select name="condition" defaultValue="UNUSED" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            {RETURN_CONDITIONS.map((c) => (
              <option key={c} value={c}>{c.replace("_", " ")}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Returned by
          <input name="returnedBy" required placeholder="Name" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
        <label className="text-xs text-muted">
          Reason
          <input name="reason" placeholder="e.g. Job cancelled" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
        <label className="text-xs text-muted">
          Remarks
          <input name="remarks" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
      </div>

      {error && <div className="text-sm text-[var(--status-critical)]">{error}</div>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending || !requestId} className="btn btn-primary btn-md">
          {pending ? "Recording…" : "Return Spare"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary btn-md">
          Cancel
        </button>
      </div>
    </form>
  );
}
