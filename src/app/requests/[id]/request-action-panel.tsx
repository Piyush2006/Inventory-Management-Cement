"use client";

import { useState, useTransition } from "react";
import {
  actionAcceptStockRequest,
  actionRejectStockRequest,
  actionRouteToSupervisor,
  actionAssignOperator,
  actionStartDelivery,
  actionMarkDelivered,
  actionConfirmReceipt,
  actionMarkNotReceived,
} from "@/app/actions";
import { formatNumber } from "@/lib/format";

type Person = { id: string; name: string };

const ROUTE_OR_ASSIGN_STATUSES = ["ACCEPTED", "PARTIALLY_RECEIVED", "NOT_RECEIVED", "ASSIGNED"];

export function RequestActionPanel({
  requestId,
  status,
  canAcceptReject,
  canRoute,
  canAssignOperator,
  isRoutedSupervisor,
  routedToName,
  isAssignedOperator,
  isRequester,
  supervisors,
  operators,
  deliveredNotYetReceived,
  uom,
}: {
  requestId: string;
  status: string;
  canAcceptReject: boolean;
  canRoute: boolean;
  canAssignOperator: boolean;
  isRoutedSupervisor: boolean;
  routedToName: string | null;
  isAssignedOperator: boolean;
  isRequester: boolean;
  supervisors: Person[];
  operators: Person[];
  deliveredNotYetReceived: number;
  uom: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [showNotReceived, setShowNotReceived] = useState(false);

  function runSimple(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
    setResult(null);
    const fd = new FormData();
    fd.set("id", requestId);
    startTransition(async () => setResult(await action(fd)));
  }

  const canShowRoute = canRoute && ROUTE_OR_ASSIGN_STATUSES.includes(status);
  const canAssign = canAssignOperator && isRoutedSupervisor && ROUTE_OR_ASSIGN_STATUSES.includes(status);
  const noActionAvailable =
    !((status === "NEW_REQUEST" && canAcceptReject) ||
      canShowRoute ||
      canAssign ||
      (status === "ASSIGNED" && isAssignedOperator) ||
      (status === "IN_TRANSIT" && isAssignedOperator) ||
      (status === "DELIVERED" && isRequester));

  if (noActionAvailable) {
    return <p className="text-sm text-muted-soft">No action available for your role at this stage.</p>;
  }

  return (
    <div className="space-y-3">
      {status === "NEW_REQUEST" && canAcceptReject && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => runSimple(actionAcceptStockRequest)} disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Working…" : "Accept"}
          </button>
          <button onClick={() => setShowReject((v) => !v)} className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-foreground">
            {showReject ? "Close" : "Reject"}
          </button>
        </div>
      )}
      {showReject && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--status-critical)]/25 bg-[var(--status-critical-bg)] p-3"
          action={(fd) => {
            setResult(null);
            startTransition(async () => {
              const res = await actionRejectStockRequest(fd);
              setResult(res);
              if (res.ok) setShowReject(false);
            });
          }}
        >
          <input type="hidden" name="id" value={requestId} />
          <input name="reason" required placeholder="Rejection reason (required)…" className="w-64 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          <button type="submit" disabled={pending} className="rounded-md bg-[var(--status-critical-solid)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            Confirm Reject
          </button>
        </form>
      )}

      {canShowRoute && (
        <form
          className="flex flex-wrap items-end gap-2"
          action={(fd) => {
            setResult(null);
            startTransition(async () => setResult(await actionRouteToSupervisor(fd)));
          }}
        >
          <input type="hidden" name="id" value={requestId} />
          <label className="text-xs text-muted">
            {routedToName ? "Re-route to Store Supervisor" : "Route to Store Supervisor"}
            <select name="supervisorUserId" required defaultValue="" className="mt-1 block w-56 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              <option value="" disabled>Select…</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending || supervisors.length === 0} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Routing…" : routedToName ? "Re-route" : "Route"}
          </button>
          {supervisors.length === 0 && <span className="text-xs text-[var(--status-critical)]">No active Store Supervisors configured.</span>}
        </form>
      )}
      {canAssignOperator && !isRoutedSupervisor && ROUTE_OR_ASSIGN_STATUSES.includes(status) && (
        <p className="text-xs text-muted-soft">
          {routedToName ? `Routed to ${routedToName} — waiting for them to assign an operator.` : "Not yet routed to a Store Supervisor."}
        </p>
      )}

      {canAssign && (
        <form
          className="flex flex-wrap items-end gap-2"
          action={(fd) => {
            setResult(null);
            startTransition(async () => setResult(await actionAssignOperator(fd)));
          }}
        >
          <input type="hidden" name="id" value={requestId} />
          <label className="text-xs text-muted">
            {status === "ASSIGNED" ? "Re-assign to" : "Assign to Store / Delivery Operator"}
            <select name="operatorUserId" required className="mt-1 block w-56 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              {operators.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending || operators.length === 0} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Assigning…" : "Assign"}
          </button>
          {operators.length === 0 && <span className="text-xs text-[var(--status-critical)]">No active Store/Delivery Operators configured.</span>}
        </form>
      )}

      {status === "ASSIGNED" && isAssignedOperator && (
        <button onClick={() => runSimple(actionStartDelivery)} disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
          {pending ? "Starting…" : "Start Delivery"}
        </button>
      )}

      {status === "IN_TRANSIT" && isAssignedOperator && (
        <form
          className="flex flex-wrap items-end gap-2"
          action={(fd) => {
            setResult(null);
            startTransition(async () => setResult(await actionMarkDelivered(fd)));
          }}
        >
          <input type="hidden" name="id" value={requestId} />
          <label className="text-xs text-muted">
            Delivery note (optional)
            <input name="deliveryNote" className="mt-1 block w-56 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Marking…" : "Mark Delivered"}
          </button>
        </form>
      )}

      {status === "DELIVERED" && isRequester && (
        <div className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            action={(fd) => {
              setResult(null);
              startTransition(async () => setResult(await actionConfirmReceipt(fd)));
            }}
          >
            <input type="hidden" name="id" value={requestId} />
            <label className="text-xs text-muted">
              Received quantity ({uom}) — {formatNumber(deliveredNotYetReceived)} delivered
              <input name="quantity" type="number" step="any" min="0.01" max={deliveredNotYetReceived} defaultValue={deliveredNotYetReceived} className="mt-1 block w-48 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
            </label>
            <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
              {pending ? "Confirming…" : "Confirm Receipt"}
            </button>
            <button type="button" onClick={() => setShowNotReceived((v) => !v)} className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-foreground">
              {showNotReceived ? "Close" : "Not Received"}
            </button>
          </form>
          {showNotReceived && (
            <form
              className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--status-critical)]/25 bg-[var(--status-critical-bg)] p-3"
              action={(fd) => {
                setResult(null);
                startTransition(async () => {
                  const res = await actionMarkNotReceived(fd);
                  setResult(res);
                  if (res.ok) setShowNotReceived(false);
                });
              }}
            >
              <input type="hidden" name="id" value={requestId} />
              <input name="reason" required placeholder="Reason material was not received (required)…" className="w-72 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
              <button type="submit" disabled={pending} className="rounded-md bg-[var(--status-critical-solid)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                Confirm Not Received
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
