"use client";

import { Fragment, useState, useTransition } from "react";
import { actionSaveMaterial, actionDeactivateMaterial } from "@/app/actions";
import { MATERIAL_CATEGORIES } from "@/lib/domain/enums";
import { formatNumber } from "@/lib/format";

type Material = {
  id: string; materialCode: string; name: string; category: string; uom: string;
  minStock: number | null; safetyStock: number | null; defaultLocationId: string | null;
  active: boolean;
};
type Location = { id: string; name: string };

function MaterialFields({ material, locations }: { material?: Material; locations: Location[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="text-xs text-muted">
        Code
        <input name="materialCode" defaultValue={material?.materialCode} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>
      <label className="text-xs text-muted sm:col-span-2">
        Name
        <input name="name" defaultValue={material?.name} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>
      <label className="text-xs text-muted">
        Category
        <select name="category" defaultValue={material?.category ?? MATERIAL_CATEGORIES[0]} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
          {MATERIAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.replace("_", " ")}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        UOM
        <select name="uom" defaultValue={material?.uom ?? "MT"} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
          <option value="MT">MT</option>
          <option value="Nos">Nos</option>
        </select>
      </label>
      <label className="text-xs text-muted">
        Default location
        <select name="defaultLocationId" defaultValue={material?.defaultLocationId ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
          <option value="">—</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        Minimum stock
        <input name="minStock" type="number" step="any" defaultValue={material?.minStock ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>
      <label className="text-xs text-muted">
        Safety stock
        <input name="safetyStock" type="number" step="any" defaultValue={material?.safetyStock ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>
      <label className="flex items-center gap-2 self-end text-xs text-muted">
        <input name="active" type="checkbox" defaultChecked={material?.active ?? true} className="h-4 w-4 rounded border-border" />
        Active
      </label>
    </div>
  );
}

export function MaterialsManager({ materials, locations, canEdit }: { materials: Material[]; locations: Location[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData, onDone: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await actionSaveMaterial(fd);
      if (!res.ok) setError(res.error ?? "Failed to save");
      else onDone();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted">{materials.length} materials</div>
        {canEdit && (
          <button onClick={() => setAdding((v) => !v)} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground">
            {adding ? "Cancel" : "+ Add Material"}
          </button>
        )}
      </div>

      {canEdit && adding && (
        <form
          className="space-y-3 rounded-md border border-accent/30 bg-accent-soft p-3"
          action={(fd) => submit(fd, () => setAdding(false))}
        >
          <MaterialFields locations={locations} />
          {error && <div className="text-sm text-[var(--status-critical)]">{error}</div>}
          <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Saving…" : "Save Material"}
          </button>
        </form>
      )}

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-soft">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Code</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Name</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Category</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">UOM</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted">Min</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted">Safety</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Active</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted"></th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <Fragment key={m.id}>
                <tr className="border-b border-border-soft last:border-0">
                  <td className="px-3 py-2.5 text-sm text-muted-soft">{m.materialCode}</td>
                  <td className="px-3 py-2.5 text-sm text-foreground">{m.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{m.category.replace("_", " ")}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{m.uom}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular text-muted">{m.minStock != null ? formatNumber(m.minStock) : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular text-muted">{m.safetyStock != null ? formatNumber(m.safetyStock) : "—"}</td>
                  <td className="px-3 py-2.5 text-xs">{m.active ? <span className="text-[var(--status-healthy)]">Active</span> : <span className="text-muted-soft">Inactive</span>}</td>
                  <td className="px-3 py-2.5">
                    {canEdit ? (
                      <div className="flex gap-2">
                        <button onClick={() => setEditingId(editingId === m.id ? null : m.id)} className="text-xs text-accent hover:underline">
                          {editingId === m.id ? "Close" : "Edit"}
                        </button>
                        <button
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("id", m.id);
                            fd.set("active", (!m.active).toString());
                            startTransition(async () => {
                              await actionDeactivateMaterial(fd);
                            });
                          }}
                          disabled={pending}
                          className="text-xs text-muted hover:text-foreground disabled:opacity-40"
                        >
                          {m.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-soft">—</span>
                    )}
                  </td>
                </tr>
                {canEdit && editingId === m.id && (
                  <tr className="border-b border-border-soft">
                    <td colSpan={8} className="bg-surface-raised px-3 py-3">
                      <form className="space-y-3" action={(fd) => submit(fd, () => setEditingId(null))}>
                        <input type="hidden" name="id" value={m.id} />
                        <MaterialFields material={m} locations={locations} />
                        {error && <div className="text-sm text-[var(--status-critical)]">{error}</div>}
                        <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-40">
                          {pending ? "Saving…" : "Save Changes"}
                        </button>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
