"use client";

import { useState, useTransition } from "react";
import {
  actionAcceptStockRequest,
  actionRejectStockRequest,
  actionCancelStockRequest,
  actionAllocateStock,
  actionIssueStock,
  actionConfirmReceipt,
} from "@/app/actions";
import { formatNumber } from "@/lib/format";

export function RequestActionPanel({
  requestId,
  status,
  isFulfilmentRole,
  isRequester,
  isOwnRequest,
  remainingToAllocate,
  activeReserved,
  inTransitForRequest,
  uom,
}: {
  requestId: string;
  status: string;
  isFulfilmentRole: boolean;
  isRequester: boolean;
  isOwnRequest: boolean;
  remainingToAllocate: number;
  activeReserved: number;
  inTransitForRequest: number;
  uom: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [showReject, setShowReject] = useState(false);

  function runSimple(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
    setResult(null);
    const fd = new FormData();
    fd.set("id", requestId);
    startTransition(async () => setResult(await action(fd)));
  }

  const noActionAvailable =
    !((status === "PENDING" && (isFulfilmentRole || isOwnRequest)) ||
      ((status === "ACCEPTED" || status === "PARTIALLY_RECEIVED") && isFulfilmentRole) ||
      (status === "ALLOCATED" && isFulfilmentRole) ||
      (status === "IN_TRANSIT" && isRequester && isOwnRequest));

  if (noActionAvailable) {
    return <p className="text-sm text-muted-soft">No action available for your role at this stage.</p>;
  }

  return (
    <div className="space-y-3">
      {status === "PENDING" && isFulfilmentRole && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => runSimple(actionAcceptStockRequest)} disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Working…" : "Accept"}
          </button>
          <button onClick={() => setShowReject((v) => !v)} className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-foreground">
            {showReject ? "Close" : "Reject"}
          </button>
        </div>
      )}
      {status === "PENDING" && isOwnRequest && (
        <button onClick={() => runSimple(actionCancelStockRequest)} disabled={pending} className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-foreground disabled:opacity-40">
          {pending ? "Working…" : "Cancel Request"}
        </button>
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
          <button type="submit" disabled={pending} className="rounded-md bg-[var(--status-critical)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            Confirm Reject
          </button>
        </form>
      )}

      {(status === "ACCEPTED" || status === "PARTIALLY_RECEIVED") && isFulfilmentRole && (
        <form
          className="flex flex-wrap items-end gap-2"
          action={(fd) => {
            setResult(null);
            startTransition(async () => setResult(await actionAllocateStock(fd)));
          }}
        >
          <input type="hidden" name="id" value={requestId} />
          <label className="text-xs text-muted">
            Allocate quantity ({uom}) — {formatNumber(remainingToAllocate)} remaining to allocate
            <input name="quantity" type="number" step="any" min="0.01" max={remainingToAllocate} defaultValue={remainingToAllocate} className="mt-1 block w-48 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Allocating…" : "Allocate Stock"}
          </button>
        </form>
      )}

      {status === "ALLOCATED" && isFulfilmentRole && (
        <form
          className="flex flex-wrap items-end gap-2"
          action={(fd) => {
            setResult(null);
            startTransition(async () => setResult(await actionIssueStock(fd)));
          }}
        >
          <input type="hidden" name="id" value={requestId} />
          <label className="text-xs text-muted">
            Issue quantity ({uom}) — {formatNumber(activeReserved)} allocated & unissued
            <input name="quantity" type="number" step="any" min="0.01" max={activeReserved} defaultValue={activeReserved} className="mt-1 block w-48 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Issuing…" : "Issue Stock"}
          </button>
        </form>
      )}

      {status === "IN_TRANSIT" && isRequester && isOwnRequest && (
        <form
          className="flex flex-wrap items-end gap-2"
          action={(fd) => {
            setResult(null);
            startTransition(async () => setResult(await actionConfirmReceipt(fd)));
          }}
        >
          <input type="hidden" name="id" value={requestId} />
          <label className="text-xs text-muted">
            Received quantity ({uom}) — {formatNumber(inTransitForRequest)} currently in transit
            <input name="quantity" type="number" step="any" min="0.01" max={inTransitForRequest} defaultValue={inTransitForRequest} className="mt-1 block w-48 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Confirming…" : "Confirm Receipt"}
          </button>
        </form>
      )}

      {result && !result.ok && <div className="text-sm text-[var(--status-critical)]">{result.error}</div>}
      {result?.ok && <div className="text-sm text-[var(--status-healthy)]">Done — this page will refresh automatically.</div>}
    </div>
  );
}
