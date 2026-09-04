"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { actionCreateStockRequest } from "@/app/actions";

type Material = { id: string; name: string; uom: string };
type SpareMaterial = { id: string; name: string; uom: string; equipmentRef: string | null };
type Location = { id: string; name: string };

export function NewRequestForm({ materials, spareMaterials, locations }: { materials: Material[]; spareMaterials: SpareMaterial[]; locations: Location[] }) {
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [fromLocationId, setFromLocationId] = useState(locations[0]?.id ?? "");
  const [toLocationId, setToLocationId] = useState(locations[1]?.id ?? locations[0]?.id ?? "");
  const [requestType, setRequestType] = useState<"MATERIAL" | "SPARE">("MATERIAL");
  const [spareMaterialId, setSpareMaterialId] = useState(spareMaterials[0]?.id ?? "");
  const [equipmentRef, setEquipmentRef] = useState("");
  const [purpose, setPurpose] = useState<"TRANSFER" | "ISSUE">("TRANSFER");
  const [issuedTo, setIssuedTo] = useState("");
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 7);
  const defaultDateStr = defaultDate.toISOString().slice(0, 10);
  const isTransfer = purpose === "TRANSFER";
  const sameLocation = isTransfer && fromLocationId !== "" && fromLocationId === toLocationId;
  const isSpare = requestType === "SPARE";

  return (
    <form
      className="space-y-3"
      action={(fd) => {
        setResult(null);
        startTransition(async () => {
          const res = await actionCreateStockRequest(fd);
          setResult(res);
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="text-xs text-muted">
          Type
          <select
            name="requestType"
            value={requestType}
            onChange={(e) => {
              const nextType = e.target.value as "MATERIAL" | "SPARE";
              setRequestType(nextType);
              if (nextType === "SPARE") setEquipmentRef(spareMaterials.find((m) => m.id === spareMaterialId)?.equipmentRef ?? "");
            }}
            className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            <option value="MATERIAL">Material</option>
            <option value="SPARE">Spare</option>
          </select>
        </label>
        {isSpare ? (
          <label className="text-xs text-muted">
            Spare
            <select
              name="materialId"
              value={spareMaterialId}
              onChange={(e) => {
                setSpareMaterialId(e.target.value);
                setEquipmentRef(spareMaterials.find((m) => m.id === e.target.value)?.equipmentRef ?? "");
              }}
              className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            >
              {spareMaterials.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="text-xs text-muted">
            Material
            <select name="materialId" defaultValue={searchParams.get("materialId") ?? materials[0]?.id} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-muted">
          Quantity
          <input name="quantityRequested" type="number" step="any" min="0.01" required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
        <label className="text-xs text-muted">
          Required by
          <input name="requiredByDate" type="date" defaultValue={defaultDateStr} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
        <label className="text-xs text-muted">
          Priority
          <select name="priority" defaultValue="NORMAL" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            <option value="NORMAL">Normal</option>
            <option value="URGENT">Urgent</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Purpose
          <select
            name="purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as "TRANSFER" | "ISSUE")}
            className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            <option value="TRANSFER">Transfer</option>
            <option value="ISSUE">Issue</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-soft">
        {isTransfer ? "Move stock from one inventory location to another." : "Issue material or a spare from Store for use. Stock will be deducted when the issue is completed."}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">
          From location
          <select
            name="fromLocationId"
            value={fromLocationId}
            onChange={(e) => setFromLocationId(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        {isTransfer ? (
          <label className="text-xs text-muted">
            To location
            <select
              name="toLocationId"
              value={toLocationId}
              onChange={(e) => setToLocationId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="text-xs text-muted">
            Issued To
            <input name="issuedTo" required value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="e.g. Maintenance, Production" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
        )}
        {sameLocation && <p className="sm:col-span-2 text-xs text-[var(--status-critical)]">From and To locations must be different.</p>}
      </div>
      {isSpare && (
        <label className="block text-xs text-muted">
          Equipment / Asset
          <input name="equipmentRef" value={equipmentRef} onChange={(e) => setEquipmentRef(e.target.value)} placeholder="e.g. Conveyor C-102" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Reason
          <input name="reason" placeholder={isSpare ? "e.g. Breakdown, Planned maintenance" : "Why is this material needed?"} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
        <label className="text-xs text-muted">
          Notes
          <input name="note" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
      </div>
      {result && !result.ok && <div className="text-sm text-[var(--status-critical)]">{result.error}</div>}
      {result && result.ok && <div className="text-sm text-[var(--status-healthy)]">Request raised.</div>}
      <button type="submit" disabled={pending || sameLocation || (isSpare && spareMaterials.length === 0) || (!isTransfer && !issuedTo.trim())} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
        {pending ? "Raising…" : "New Stock Request"}
      </button>
      {isSpare && spareMaterials.length === 0 && <p className="text-xs text-muted-soft">No active spares in the master yet — add one under Spare Management → Spare Master.</p>}
    </form>
  );
}
