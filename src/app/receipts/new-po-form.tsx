"use client";

import { useState, useTransition } from "react";
import { actionCreatePurchaseReference } from "@/app/actions";
import { SupplierPicker } from "./supplier-picker";

type Material = { id: string; name: string; uom: string };
type Supplier = { id: string; name: string };

export function NewPoForm({ materials, suppliers }: { materials: Material[]; suppliers: Supplier[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string; poNumber?: string } | null>(null);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground">
        + Create Purchase Reference
      </button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-md border border-accent/30 bg-accent-soft p-3"
      action={(fd) => {
        setResult(null);
        startTransition(async () => {
          const res = await actionCreatePurchaseReference(fd);
          setResult(res);
          if (res.ok) setOpen(false);
        });
      }}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-soft">New Purchase / Source Reference</div>
      <SupplierPicker suppliers={suppliers} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted">
          Material
          <select name="materialId" required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            {materials.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Ordered quantity
          <input name="orderedQuantity" type="number" step="any" min="0.01" required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
        <label className="text-xs text-muted">
          Expected delivery
          <input name="expectedDeliveryDate" type="date" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
      </div>
      <label className="block text-xs text-muted">
        Note
        <input name="note" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>
      {result && !result.ok && <div className="text-sm text-[var(--status-critical)]">{result.error}</div>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-40">
          {pending ? "Saving…" : "Save Reference"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted-soft hover:text-foreground">Cancel</button>
      </div>
    </form>
  );
}
