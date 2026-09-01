"use client";

import { useState, useTransition } from "react";
import { actionPostCountAdjustment } from "@/app/actions";
import { formatNumber } from "@/lib/format";

type PendingCount = {
  id: string;
  materialName: string;
  uom: string;
  locationName: string;
  bookQuantity: number;
  countedQuantity: number;
  tolerancePct: number;
  countedBy: string;
  note: string | null;
};

function CountRow({ count }: { count: PendingCount }) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const variance = count.countedQuantity - count.bookQuantity;
  const variancePct = count.bookQuantity === 0 ? (variance === 0 ? 0 : 100) : (variance / count.bookQuantity) * 100;
  const withinTolerance = Math.abs(variancePct) <= count.tolerancePct;

  function submit() {
    setResult(null);
    const fd = new FormData();
    fd.set("physicalCountId", count.id);
    fd.set("reason", reason);
    startTransition(async () => {
      const res = await actionPostCountAdjustment(fd);
      setResult(res);
    });
  }

  return (
    <div className="rounded-md border border-border-soft bg-surface-raised p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-foreground">{count.materialName} — {count.locationName}</div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${withinTolerance ? "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]" : "text-[var(--status-warning)] bg-[var(--status-warning-bg)]"}`}>
          {withinTolerance ? `Within Tolerance (±${count.tolerancePct}%)` : `Investigation Required (±${count.tolerancePct}%)`}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-soft">Book</div>
          <div className="tabular text-foreground">{formatNumber(count.bookQuantity)} {count.uom}</div>
        </div>
        <div>
          <div className="text-muted-soft">Counted</div>
          <div className="tabular text-foreground">{formatNumber(count.countedQuantity)} {count.uom}</div>
        </div>
        <div>
          <div className="text-muted-soft">Variance</div>
          <div className="tabular text-foreground">{variance >= 0 ? "+" : ""}{formatNumber(variance)} ({variancePct.toFixed(1)}%)</div>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-muted-soft">Counted by {count.countedBy}{count.note ? ` — ${count.note}` : ""}</div>
      <div className="mt-2 flex items-center gap-2">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for adjustment" className="block w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent" />
        <button type="button" onClick={submit} disabled={pending || !reason.trim()} className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground disabled:opacity-40">
          {pending ? "Posting…" : "Approve & Post"}
        </button>
      </div>
      {result && !result.ok && <div className="mt-1 text-xs text-[var(--status-critical)]">{result.error}</div>}
    </div>
  );
}

export function PendingCountsPanel({ counts }: { counts: PendingCount[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {counts.map((c) => (
        <CountRow key={c.id} count={c} />
      ))}
    </div>
  );
}
