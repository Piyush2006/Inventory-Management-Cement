"use client";

import { Fragment, useState, useTransition } from "react";
import { actionSaveLocation, actionDeactivateLocation } from "@/app/actions";
import { LOCATION_TYPES } from "@/lib/domain/enums";
import { formatNumber } from "@/lib/format";

type Location = { id: string; name: string; type: string; capacity: number | null; active: boolean; stockQty: number };

function LocationFields({ location }: { location?: Location }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <label className="text-xs text-muted sm:col-span-2">
        Name
        <input name="name" defaultValue={location?.name} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>
      <label className="text-xs text-muted">
        Type
        <select name="type" defaultValue={location?.type ?? LOCATION_TYPES[0]} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
          {LOCATION_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        Capacity (optional)
        <input name="capacity" type="number" step="any" defaultValue={location?.capacity ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>
      <label className="flex items-center gap-2 self-end text-xs text-muted">
        <input name="active" type="checkbox" defaultChecked={location?.active ?? true} className="h-4 w-4 rounded border-border" />
        Active
      </label>
    </div>
  );
}

export function LocationsManager({ locations, canEdit }: { locations: Location[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData, onDone: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await actionSaveLocation(fd);
      if (!res.ok) setError(res.error ?? "Failed to save");
      else onDone();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted">{locations.length} locations</div>
        {canEdit && (
          <button onClick={() => setAdding((v) => !v)} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground">
            {adding ? "Cancel" : "+ Add Location"}
          </button>
        )}
      </div>

      {canEdit && adding && (
        <form className="space-y-3 rounded-md border border-accent/30 bg-accent-soft p-3" action={(fd) => submit(fd, () => setAdding(false))}>
          <LocationFields />
          {error && <div className="text-sm text-[var(--status-critical)]">{error}</div>}
          <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-40">
            {pending ? "Saving…" : "Save Location"}
          </button>
        </form>
      )}

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-soft">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Name</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Type</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted">Capacity</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted">Current Stock</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Active</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted"></th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <Fragment key={l.id}>
                <tr className="border-b border-border-soft last:border-0">
                  <td className="px-3 py-2.5 text-sm text-foreground">{l.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{l.type}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular text-muted">{l.capacity != null ? formatNumber(l.capacity) : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular text-muted">{formatNumber(l.stockQty)}</td>
                  <td className="px-3 py-2.5 text-xs">{l.active ? <span className="text-[var(--status-healthy)]">Active</span> : <span className="text-muted-soft">Inactive</span>}</td>
                  <td className="px-3 py-2.5">
                    {canEdit ? (
                      <div className="flex gap-2">
                        <button onClick={() => setEditingId(editingId === l.id ? null : l.id)} className="text-xs text-accent hover:underline">
                          {editingId === l.id ? "Close" : "Edit"}
                        </button>
                        <button
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("id", l.id);
                            fd.set("active", (!l.active).toString());
                            setError(null);
                            startTransition(async () => {
                              const res = await actionDeactivateLocation(fd);
                              if (!res.ok) setError(res.error ?? "Failed");
                            });
                          }}
                          disabled={pending}
                          className="text-xs text-muted hover:text-foreground disabled:opacity-40"
                        >
                          {l.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-soft">—</span>
                    )}
                  </td>
                </tr>
                {canEdit && editingId === l.id && (
                  <tr className="border-b border-border-soft">
                    <td colSpan={6} className="bg-surface-raised px-3 py-3">
                      <form className="space-y-3" action={(fd) => submit(fd, () => setEditingId(null))}>
                        <input type="hidden" name="id" value={l.id} />
                        <LocationFields location={l} />
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
      {error && <div className="text-sm text-[var(--status-critical)]">{error}</div>}
    </div>
  );
}
