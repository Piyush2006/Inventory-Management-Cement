"use client";

import { useMemo, useState, useTransition } from "react";
import { actionPostSpareReturn } from "@/app/actions";
import { RETURN_CONDITIONS } from "@/lib/domain/enums";
import { formatNumber } from "@/lib/format";

type Material = { id: string; name: string; uom: string };
type Location = { id: string; name: string };
type SpareRequestOption = { id: string; requestNumber: string; materialId: string; issued: number; alreadyReturned: number };

export function SpareReturnForm({ materials, locations, requests }: { materials: Material[]; locations: Location[]; requests: SpareRequestOption[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? "");
  const [relatedRequestNumber, setRelatedRequestNumber] = useState("");
  const [quantity, setQuantity] = useState("");
  const [confirmOverReturn, setConfirmOverReturn] = useState(false);

  const relevantRequests = useMemo(() => requests.filter((r) => r.materialId === materialId), [requests, materialId]);
  const selectedRequest = relevantRequests.find((r) => r.requestNumber === relatedRequestNumber);
  const material = materials.find((m) => m.id === materialId);
  const qty = Number(quantity);
  const remainingIssued = selectedRequest ? selectedRequest.issued - selectedRequest.alreadyReturned : null;
  const isOverReturn = selectedRequest != null && !Number.isNaN(qty) && qty > 0 && remainingIssued != null && qty > remainingIssued;

  return (
    <form
      className="space-y-3"
      action={(fd) => {
        setResult(null);
        startTransition(async () => {
          const res = await actionPostSpareReturn(fd);
          setResult(res);
          if (res.ok) {
            setQuantity("");
            setConfirmOverReturn(false);
          }
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
              setRelatedRequestNumber("");
            }}
            className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            {materials.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
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
          Quantity
          <input
            name="quantity"
            type="number"
            step="any"
            min="0.01"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          />
        </label>
        <label className="text-xs text-muted">
          Condition
          <select name="condition" defaultValue="UNUSED" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            {RETURN_CONDITIONS.map((c) => (
              <option key={c} value={c}>{c.replace("_", " ")}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted">
          Related request (optional)
          <select
            name="relatedRequestNumber"
            value={relatedRequestNumber}
            onChange={(e) => setRelatedRequestNumber(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            <option value="">—</option>
            {relevantRequests.map((r) => (
              <option key={r.id} value={r.requestNumber}>
                {r.requestNumber} ({formatNumber(r.issued - r.alreadyReturned)} {material?.uom ?? ""} remaining)
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Returned by
          <input name="returnedBy" required placeholder="Name" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
        <label className="text-xs text-muted">
          Remarks
          <input name="remarks" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
      </div>

      {isOverReturn && (
        <div className="rounded-md border border-[var(--status-warning)]/30 bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-foreground">
          <div>
            This exceeds what&apos;s on record as issued for {selectedRequest?.requestNumber} ({formatNumber(remainingIssued ?? 0)} {material?.uom} remaining).
          </div>
          <label className="mt-1.5 flex items-center gap-2">
            <input type="checkbox" checked={confirmOverReturn} onChange={(e) => setConfirmOverReturn(e.target.checked)} className="h-4 w-4 rounded border-border" />
            Yes, return more than issued
          </label>
        </div>
      )}

      {result && !result.ok && <div className="text-sm text-[var(--status-critical)]">{result.error}</div>}
      {result && result.ok && <div className="text-sm text-[var(--status-healthy)]">Return recorded.</div>}
      <button type="submit" disabled={pending || (isOverReturn && !confirmOverReturn)} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
        {pending ? "Recording…" : "Record Spare Return"}
      </button>
    </form>
  );
}
