"use client";

import { useMemo, useState, useTransition } from "react";
import { actionRecordCountAndAdjust } from "@/app/actions";
import { formatNumber } from "@/lib/format";

type BalanceRow = { materialId: string; materialName: string; uom: string; locationId: string; locationName: string; quantity: number };

export function CountAdjustForm({ balances }: { balances: BalanceRow[] }) {
  const [locationId, setLocationId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string; varianceQty?: number; adjusted?: boolean } | null>(null);

  const locations = useMemo(() => [...new Map(balances.map((b) => [b.locationId, b.locationName])).entries()], [balances]);
  const materialsForLocation = useMemo(() => balances.filter((b) => b.locationId === locationId), [balances, locationId]);
  const selected = materialsForLocation.find((b) => b.materialId === materialId);

  const countedNum = Number(counted);
  const hasCount = selected && counted !== "" && !Number.isNaN(countedNum);
  const variance = hasCount ? countedNum - selected.quantity : null;
  const variancePct = hasCount && variance != null ? (selected!.quantity === 0 ? (variance === 0 ? 0 : 100) : (variance / selected!.quantity) * 100) : null;
  const needsReason = variance != null && Math.abs(variance) > 1e-9;

  return (
    <form
      className="space-y-3"
      action={(fd) => {
        setResult(null);
        startTransition(async () => {
          const res = await actionRecordCountAndAdjust(fd);
          setResult(res);
          if (res.ok) {
            setCounted("");
            setReason("");
          }
        });
      }}
    >
      <p className="text-xs text-muted-soft">
        Enter what you physically count — the system shows book stock and the resulting variance. A reason is
        required only when there&apos;s a variance, and posting it is the only way stock changes here.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted">
          Location
          <select name="locationId" value={locationId} onChange={(e) => { setLocationId(e.target.value); setMaterialId(""); setCounted(""); }} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            <option value="">Select a location…</option>
            {locations.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Material
          <select name="materialId" value={materialId} onChange={(e) => { setMaterialId(e.target.value); setCounted(""); }} disabled={!locationId} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            <option value="">Select a material…</option>
            {materialsForLocation.map((b) => (
              <option key={b.materialId} value={b.materialId}>{b.materialName}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Counted quantity
          <input name="countedQuantity" type="number" step="any" value={counted} onChange={(e) => setCounted(e.target.value)} disabled={!materialId} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
      </div>

      {selected && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border-soft bg-surface-raised px-3 py-2 text-sm">
            <div className="text-[10px] uppercase tracking-wide text-muted-soft">System Stock</div>
            <div className="mt-0.5 font-medium tabular text-foreground">{formatNumber(selected.quantity)} {selected.uom}</div>
          </div>
          <div className="rounded-md border border-border-soft bg-surface-raised px-3 py-2 text-sm">
            <div className="text-[10px] uppercase tracking-wide text-muted-soft">Physical / Counted Stock</div>
            <div className="mt-0.5 font-medium tabular text-foreground">{hasCount ? `${formatNumber(countedNum)} ${selected.uom}` : "—"}</div>
          </div>
          <div className={`rounded-md border px-3 py-2 text-sm ${!hasCount ? "border-border-soft bg-surface-raised" : Math.abs(variance!) > 1e-9 ? "border-[var(--status-warning)]/30 bg-[var(--status-warning-bg)]" : "border-[var(--status-healthy)]/30 bg-[var(--status-healthy-bg)]"}`}>
            <div className="text-[10px] uppercase tracking-wide text-muted-soft">Variance</div>
            <div className="mt-0.5 font-medium tabular text-foreground">
              {hasCount ? `${variance! >= 0 ? "+" : ""}${formatNumber(variance!)} ${selected.uom} (${variancePct!.toFixed(1)}%)` : "—"}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Counted by
          <input name="countedBy" defaultValue="Plant Storekeeper" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
        <label className="text-xs text-muted">
          Note (optional)
          <input name="note" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
      </div>

      {needsReason && (
        <label className="block text-xs text-muted">
          Reason for adjustment (required — this variance will be posted to correct book stock)
          <input name="reason" value={reason} onChange={(e) => setReason(e.target.value)} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
      )}

      {result && !result.ok && <div className="text-sm text-[var(--status-critical)]">{result.error}</div>}
      {result?.ok && (
        <div className="text-sm text-[var(--status-healthy)]">
          {result.adjusted ? `Count recorded and adjustment posted (${result.varianceQty! >= 0 ? "+" : ""}${formatNumber(result.varianceQty!)}).` : "Count recorded — matched book stock, nothing to adjust."}
        </div>
      )}

      <button type="submit" disabled={pending || !materialId || counted === ""} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
        {pending ? "Confirming…" : needsReason ? "Confirm & Post Adjustment" : "Record Count"}
      </button>
    </form>
  );
}
