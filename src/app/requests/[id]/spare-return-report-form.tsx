"use client";

import { useState, useTransition } from "react";
import { actionReportSpareReturn } from "@/app/actions";
import { formatNumber } from "@/lib/format";

export function SpareReturnReportForm({
  requestId,
  remaining,
  uom,
  defaultReturnedBy,
  onDone,
  onCancel,
}: {
  requestId: string;
  remaining: number;
  uom: string;
  defaultReturnedBy: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      action={(fd) => {
        setError(null);
        fd.set("requestId", requestId);
        startTransition(async () => {
          const res = await actionReportSpareReturn(fd);
          if (!res.ok) setError(res.error);
          else onDone();
        });
      }}
    >
      <p className="text-xs text-muted-soft">
        Reports that a spare is being returned to Store. This does not change inventory yet — a Store Operator will
        receive it, verify quantity and condition, and complete the return.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Quantity ({formatNumber(remaining)} {uom} eligible)
          <input
            name="quantity"
            type="number"
            step="any"
            min="0.01"
            max={remaining}
            required
            className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          />
        </label>
        <label className="text-xs text-muted">
          Returned by
          <input name="returnedBy" required defaultValue={defaultReturnedBy} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
      </div>
      <label className="block text-xs text-muted">
        Reason
        <input name="reason" placeholder="e.g. Job cancelled" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>
      <label className="block text-xs text-muted">
        Remarks (optional)
        <input name="remarks" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>

      {error && <div className="text-sm text-[var(--status-critical)]">{error}</div>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending || remaining <= 0} className="btn btn-primary btn-md">
          {pending ? "Reporting…" : "Report Return"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary btn-md">
          Cancel
        </button>
      </div>
    </form>
  );
}
