"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { actionCreateDispatch } from "@/app/actions";
import { Th, Td, EmptyState } from "@/components/ui";
import { formatNumber, formatDate } from "@/lib/format";
import { DISPATCH_STATUSES } from "@/lib/domain/enums";

type Material = { id: string; name: string; uom: string };
type Location = { id: string; name: string };
type BalanceRow = { materialId: string; uom: string; locationId: string; unrestrictedQuantity: number };
type DispatchRow = {
  id: string; dispatchReference: string; materialId: string; materialName: string; uom: string; quantity: number;
  sourceLocationId: string; sourceLocationName: string; customerDestination: string; status: string;
  assignedToName: string | null; createdAt: Date;
};

const STATUS_TONE: Record<string, string> = {
  CREATED: "text-muted bg-surface-raised",
  APPROVED: "text-[var(--status-transit)] bg-[var(--status-transit-bg)]",
  LOADING: "text-[var(--status-warning)] bg-[var(--status-warning-bg)]",
  DISPATCHED: "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]",
  CANCELLED: "text-[var(--status-critical)] bg-[var(--status-critical-bg)]",
};

export function DispatchPanel({
  dispatches,
  materials,
  locations,
  balances,
  canCreate,
}: {
  dispatches: DispatchRow[];
  materials: Material[];
  locations: Location[];
  balances: BalanceRow[];
  canCreate: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? "");
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const [statusFilter, setStatusFilter] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const material = materials.find((m) => m.id === materialId);
  const unrestricted = balances.find((b) => b.materialId === materialId && b.locationId === sourceLocationId)?.unrestrictedQuantity ?? 0;

  const filtered = useMemo(() => {
    return dispatches.filter((d) => {
      if (statusFilter && d.status !== statusFilter) return false;
      if (materialFilter && d.materialId !== materialFilter) return false;
      if (locationFilter && d.sourceLocationId !== locationFilter) return false;
      if (dateFilter && d.createdAt.toISOString().slice(0, 10) !== dateFilter) return false;
      return true;
    });
  }, [dispatches, statusFilter, materialFilter, locationFilter, dateFilter]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-soft">Material leaving the plant for a customer — separate from the internal Stock Request lifecycle. Only Unrestricted stock is eligible; inventory only decreases once a dispatch is actually marked Dispatched.</p>

      {canCreate && (
        <div className="space-y-3">
          <button type="button" onClick={() => setShowCreate((v) => !v)} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground">
            {showCreate ? "Close" : "+ New Dispatch"}
          </button>
          {showCreate && (
            <form
              className="grid grid-cols-1 gap-3 rounded-md border border-border-soft bg-surface-raised p-3 sm:grid-cols-3"
              action={(fd) => {
                setResult(null);
                startTransition(async () => {
                  const res = await actionCreateDispatch(fd);
                  setResult(res);
                  if (res.ok) setShowCreate(false);
                });
              }}
            >
              <label className="text-xs text-muted">
                Material
                <select name="materialId" value={materialId} onChange={(e) => setMaterialId(e.target.value)} required className="mt-1 block w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted">
                Source Location
                <select name="sourceLocationId" value={sourceLocationId} onChange={(e) => setSourceLocationId(e.target.value)} required className="mt-1 block w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                  <option value="">Select…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted">
                Quantity {material ? `(${material.uom})` : ""}
                <input name="quantity" type="number" step="any" min="0.01" required className="mt-1 block w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
                {sourceLocationId && <span className="mt-1 block text-[11px] text-muted-soft">{formatNumber(unrestricted)} {material?.uom} Unrestricted available here</span>}
              </label>
              <label className="text-xs text-muted sm:col-span-3">
                Customer / Destination
                <input name="customerDestination" required className="mt-1 block w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
              </label>
              <label className="text-xs text-muted">
                Batch / Lot (optional)
                <input name="batchLot" className="mt-1 block w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
              </label>
              <label className="text-xs text-muted">
                Weighment Reference (optional)
                <input name="weighmentReference" className="mt-1 block w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
              </label>
              <label className="text-xs text-muted">
                Notes (optional)
                <input name="notes" className="mt-1 block w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
              </label>

              {result && !result.ok && <div className="text-sm text-[var(--status-critical)] sm:col-span-3">{result.error}</div>}

              <div className="sm:col-span-3">
                <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
                  {pending ? "Creating…" : "Create Dispatch"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent">
          <option value="">All statuses</option>
          {DISPATCH_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={materialFilter} onChange={(e) => setMaterialFilter(e.target.value)} className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent">
          <option value="">All materials</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent">
          <option value="">All source locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No dispatches match" />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-soft">
                <Th>Reference</Th>
                <Th>Material</Th>
                <Th className="text-right">Quantity</Th>
                <Th>Source</Th>
                <Th>Customer / Destination</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-b border-border-soft last:border-0">
                  <Td className="text-xs text-muted-soft">{d.dispatchReference}</Td>
                  <Td>{d.materialName}</Td>
                  <Td className="text-right tabular">{formatNumber(d.quantity)} {d.uom}</Td>
                  <Td className="text-xs text-muted">{d.sourceLocationName}</Td>
                  <Td className="text-xs text-muted">{d.customerDestination}</Td>
                  <Td><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[d.status] ?? ""}`}>{d.status}</span></Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDate(d.createdAt)}</Td>
                  <Td><Link href={`/movements/dispatches/${d.id}`} className="text-xs text-accent hover:underline">Details →</Link></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
