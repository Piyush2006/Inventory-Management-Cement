"use client";

import { useState, useTransition } from "react";
import { actionChangeQualityStatus } from "@/app/actions";
import { formatNumber } from "@/lib/format";
import { QUALITY_STATUS_LABELS } from "@/lib/domain/enums";
import type { QualityStatus } from "@/lib/domain/enums";

type LocationQuality = { locationId: string; locationName: string; onHand: number; unrestricted: number; qcHold: number; blocked: number };

const STATUS_OPTIONS: QualityStatus[] = ["UNRESTRICTED", "QC_HOLD", "BLOCKED"];

function bucketQty(loc: LocationQuality, status: QualityStatus) {
  if (status === "UNRESTRICTED") return loc.unrestricted;
  if (status === "QC_HOLD") return loc.qcHold;
  return loc.blocked;
}

function LocationQualityRow({ materialId, uom, loc, canManage }: { materialId: string; uom: string; loc: LocationQuality; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [fromStatus, setFromStatus] = useState<QualityStatus>("UNRESTRICTED");
  const [toStatus, setToStatus] = useState<QualityStatus>("QC_HOLD");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const fromAvailable = bucketQty(loc, fromStatus);
  const toOptions = STATUS_OPTIONS.filter((s) => s !== fromStatus);
  const needsReason = toStatus !== "UNRESTRICTED";

  function submit() {
    setResult(null);
    const fd = new FormData();
    fd.set("materialId", materialId);
    fd.set("locationId", loc.locationId);
    fd.set("quantity", quantity);
    fd.set("fromStatus", fromStatus);
    fd.set("toStatus", toStatus);
    fd.set("reason", reason);
    startTransition(async () => {
      const res = await actionChangeQualityStatus(fd);
      setResult(res);
      if (res.ok) {
        setQuantity("");
        setReason("");
        setOpen(false);
      }
    });
  }

  return (
    <div className="rounded-md border border-border-soft bg-surface-raised p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-foreground">{loc.locationName}</div>
        {canManage && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-accent hover:underline">
            {open ? "Cancel" : "Change status"}
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
        <div>
          <div className="text-muted-soft">On Hand</div>
          <div className="tabular text-foreground">{formatNumber(loc.onHand)}</div>
        </div>
        <div>
          <div className="text-muted-soft">Unrestricted</div>
          <div className="tabular text-foreground">{formatNumber(loc.unrestricted)}</div>
        </div>
        <div>
          <div className="text-muted-soft">QC Hold</div>
          <div className={`tabular ${loc.qcHold > 0 ? "text-[var(--status-warning)]" : "text-foreground"}`}>{formatNumber(loc.qcHold)}</div>
        </div>
        <div>
          <div className="text-muted-soft">Blocked</div>
          <div className={`tabular ${loc.blocked > 0 ? "text-[var(--status-critical)]" : "text-foreground"}`}>{formatNumber(loc.blocked)}</div>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-border-soft pt-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-muted">
              From
              <select
                value={fromStatus}
                onChange={(e) => {
                  const next = e.target.value as QualityStatus;
                  setFromStatus(next);
                  if (toStatus === next) setToStatus(STATUS_OPTIONS.find((s) => s !== next) as QualityStatus);
                }}
                className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{QUALITY_STATUS_LABELS[s]} ({formatNumber(bucketQty(loc, s))})</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              To
              <select value={toStatus} onChange={(e) => setToStatus(e.target.value as QualityStatus)} className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                {toOptions.map((s) => (
                  <option key={s} value={s}>{QUALITY_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Quantity ({uom})
              <input type="number" step="any" min="0.01" max={fromAvailable || undefined} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
            </label>
            <label className="text-xs text-muted">
              Reason {needsReason ? "(required)" : "(optional)"}
              <input value={reason} onChange={(e) => setReason(e.target.value)} required={needsReason} className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
            </label>
          </div>
          <p className="text-[11px] text-muted-soft">{formatNumber(fromAvailable)} {uom} currently {QUALITY_STATUS_LABELS[fromStatus].toLowerCase()} at {loc.locationName}.</p>
          {result && !result.ok && <div className="text-xs text-[var(--status-critical)]">{result.error}</div>}
          <button
            type="button"
            onClick={submit}
            disabled={pending || !quantity || Number(quantity) <= 0 || Number(quantity) > fromAvailable + 1e-6 || (needsReason && !reason.trim())}
            className="btn btn-primary btn-xs"
          >
            {pending ? "Saving…" : "Confirm"}
          </button>
        </div>
      )}
    </div>
  );
}

export function QualityPanel({ materialId, uom, locations, canManage }: { materialId: string; uom: string; locations: LocationQuality[]; canManage: boolean }) {
  if (locations.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {locations.map((loc) => (
        <LocationQualityRow key={loc.locationId} materialId={materialId} uom={uom} loc={loc} canManage={canManage} />
      ))}
    </div>
  );
}
