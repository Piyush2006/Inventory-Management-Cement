"use client";

import { useState, useTransition } from "react";
import {
  actionApproveDispatch,
  actionReassignDispatchOperator,
  actionStartDispatchLoading,
  actionMarkDispatched,
  actionCancelDispatch,
} from "@/app/actions";

type Person = { id: string; name: string };

export function DispatchActionPanel({
  dispatchId,
  status,
  canApprove,
  canExecute,
  canCancel,
  isAssignedOperator,
  operators,
}: {
  dispatchId: string;
  status: string;
  canApprove: boolean;
  canExecute: boolean;
  canCancel: boolean;
  isAssignedOperator: boolean;
  operators: Person[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [showReassign, setShowReassign] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  function runSimple(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
    setResult(null);
    const fd = new FormData();
    fd.set("id", dispatchId);
    startTransition(async () => setResult(await action(fd)));
  }

  const canStartLoading = canExecute && isAssignedOperator && status === "APPROVED";
  const canMarkDispatched = canExecute && isAssignedOperator && status === "LOADING";
  const canShowCancel = canCancel && ["CREATED", "APPROVED", "LOADING"].includes(status);
  const canShowReassign = canApprove && status === "APPROVED";

  const noActionAvailable =
    !((status === "CREATED" && canApprove) || canStartLoading || canMarkDispatched || canShowCancel || canShowReassign);

  if (noActionAvailable) {
    return <p className="text-sm text-muted-soft">{status === "DISPATCHED" ? "Dispatched — no stock-changing action is available." : status === "CANCELLED" ? "Cancelled." : "No action available for your role at this stage."}</p>;
  }

  return (
    <div className="space-y-3">
      {status === "CREATED" && canApprove && (
        <form
          className="flex flex-wrap items-end gap-2"
          action={(fd) => {
            setResult(null);
            startTransition(async () => setResult(await actionApproveDispatch(fd)));
          }}
        >
          <input type="hidden" name="id" value={dispatchId} />
          <label className="text-xs text-muted">
            Assign to Store / Delivery Operator
            <select name="operatorUserId" required className="mt-1 block w-56 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              {operators.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending || operators.length === 0} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Approving…" : "Approve"}
          </button>
          {operators.length === 0 && <span className="text-xs text-[var(--status-critical)]">No active Store/Delivery Operators configured.</span>}
        </form>
      )}

      {canShowReassign && (
        <div className="space-y-2">
          <button type="button" onClick={() => setShowReassign((v) => !v)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground">
            {showReassign ? "Close" : "Reassign Operator"}
          </button>
          {showReassign && (
            <form
              className="flex flex-wrap items-end gap-2"
              action={(fd) => {
                setResult(null);
                startTransition(async () => {
                  const res = await actionReassignDispatchOperator(fd);
                  setResult(res);
                  if (res.ok) setShowReassign(false);
                });
              }}
            >
              <input type="hidden" name="id" value={dispatchId} />
              <label className="text-xs text-muted">
                New Operator
                <select name="operatorUserId" required className="mt-1 block w-56 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                  {operators.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
                {pending ? "Reassigning…" : "Reassign"}
              </button>
            </form>
          )}
        </div>
      )}

      {canStartLoading && (
        <button onClick={() => runSimple(actionStartDispatchLoading)} disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
          {pending ? "Starting…" : "Start Loading"}
        </button>
      )}

      {canMarkDispatched && (
        <button onClick={() => runSimple(actionMarkDispatched)} disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
          {pending ? "Marking…" : "Mark Dispatched"}
        </button>
      )}

      {canShowCancel && (
        <div className="space-y-2">
          <button type="button" onClick={() => setShowCancel((v) => !v)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground">
            {showCancel ? "Close" : "Cancel Dispatch"}
          </button>
          {showCancel && (
            <form
              className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--status-critical)]/25 bg-[var(--status-critical-bg)] p-3"
              action={(fd) => {
                setResult(null);
                startTransition(async () => {
                  const res = await actionCancelDispatch(fd);
                  setResult(res);
                  if (res.ok) setShowCancel(false);
                });
              }}
            >
              <input type="hidden" name="id" value={dispatchId} />
              <input name="reason" required placeholder="Cancellation reason (required)…" className="w-64 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
              <button type="submit" disabled={pending} className="rounded-md bg-[var(--status-critical-solid)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                Confirm Cancel
              </button>
            </form>
          )}
        </div>
      )}

      {result && !result.ok && <div className="text-sm text-[var(--status-critical)]">{result.error}</div>}
      {result?.ok && <div className="text-sm text-[var(--status-healthy)]">Done — this page will refresh automatically.</div>}
    </div>
  );
}
