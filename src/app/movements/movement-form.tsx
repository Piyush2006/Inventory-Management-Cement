"use client";

import { useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { actionRecordMovement } from "@/app/actions";
import type { TransactionType } from "@/lib/domain/enums";

type Material = { id: string; name: string; uom: string };
type Location = { id: string; name: string };

export const LEDGER_MOVEMENT_TYPES: { type: TransactionType; label: string; help: string }[] = [
  { type: "RECEIPT", label: "Receive Stock", help: "Material arriving from a supplier." },
  { type: "CONSUMPTION", label: "Record Consumption", help: "Material consumed by a production process." },
  { type: "TRANSFER", label: "Transfer Stock", help: "Move stock between two plant locations." },
  { type: "DISPATCH", label: "Dispatch", help: "Finished goods leaving to a customer." },
];

export function MovementForm({ type, materials, locations }: { type: TransactionType; materials: Material[]; locations: Location[] }) {
  const searchParams = useSearchParams();
  const [materialId, setMaterialId] = useState(searchParams.get("materialId") ?? materials[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const material = useMemo(() => materials.find((m) => m.id === materialId), [materials, materialId]);
  const activeType = LEDGER_MOVEMENT_TYPES.find((t) => t.type === type)!;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-soft">{activeType.help}</p>
      <form
        className="space-y-3"
        action={(formData) => {
          setResult(null);
          startTransition(async () => {
            const res = await actionRecordMovement(formData);
            setResult(res);
          });
        }}
      >
        <input type="hidden" name="transactionType" value={type} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">
            Material
            <select
              name="materialId"
              value={materialId}
              onChange={(e) => setMaterialId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            >
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Quantity {material ? `(${material.uom})` : ""}
            <input name="quantity" type="number" step="any" min="0.01" required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>

          {type === "TRANSFER" ? (
            <>
              <label className="text-xs text-muted">
                From Location
                <select name="sourceLocationId" required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted">
                To Location
                <select name="destinationLocationId" required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label className="text-xs text-muted">
              {type === "RECEIPT" ? "To Location" : type === "DISPATCH" ? "From Location" : "From Location"}
              <select name="locationId" required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
          )}

          {type === "CONSUMPTION" && (
            <label className="text-xs text-muted">
              Production unit / process
              <input name="processName" placeholder="e.g. Kiln, Cement Mill" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
            </label>
          )}

          <label className="text-xs text-muted sm:col-span-2">
            {type === "RECEIPT" ? "Supplier / reference" : type === "DISPATCH" ? "Customer / reference" : "Reference"}
            <input name="reference" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
        </div>

        {result && !result.ok && <div className="text-sm text-[var(--status-critical)]">{result.error}</div>}
        {result && result.ok && <div className="text-sm text-[var(--status-healthy)]">Movement recorded — inventory updated.</div>}

        <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
          {pending ? "Recording…" : activeType.label}
        </button>
      </form>
    </div>
  );
}
