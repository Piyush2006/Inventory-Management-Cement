"use client";

import { useState } from "react";

type Supplier = { id: string; name: string };

export function SupplierPicker({ suppliers, defaultSupplierId }: { suppliers: Supplier[]; defaultSupplierId?: string }) {
  const [addingNew, setAddingNew] = useState(suppliers.length === 0);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {!addingNew ? (
        <label className="text-xs text-muted sm:col-span-2">
          Supplier
          <select name="supplierId" defaultValue={defaultSupplierId ?? suppliers[0]?.id} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="text-xs text-muted">
            New supplier name
            <input name="newSupplierName" required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Reference (optional)
            <input name="supplierReferenceCode" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
        </>
      )}
      <div className="flex items-end">
        <button
          type="button"
          onClick={() => setAddingNew((v) => !v)}
          className="text-xs text-accent hover:underline"
        >
          {addingNew ? (suppliers.length > 0 ? "Choose existing supplier" : "") : "+ New supplier"}
        </button>
      </div>
    </div>
  );
}
