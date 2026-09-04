"use client";

import { Fragment, useState, useTransition } from "react";
import { actionSaveLocation, actionDeleteLocation } from "@/app/actions";
import { LOCATION_TYPES } from "@/lib/domain/enums";
import { formatNumber } from "@/lib/format";
import { EditIcon, DeleteIcon } from "@/components/ui";
import { Modal } from "@/components/modal";

// Same two values materials-manager.tsx's own UOM select offers — no new vocabulary, no
// conversion logic. A location's capacity UOM is independent of any material's own uom.
const CAPACITY_UOMS = ["MT", "Nos"] as const;

type Location = {
  id: string; name: string; type: string; capacity: number | null; capacityUom: string | null;
  stockQty: number; stockByUom: { uom: string; qty: number }[];
};

function formatStock(l: Location) {
  if (l.stockByUom.length === 0) return formatNumber(l.stockQty);
  return l.stockByUom.map((s) => `${formatNumber(s.qty)} ${s.uom}`).join(", ");
}

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
        <div className="mt-1 flex gap-1.5">
          <input name="capacity" type="number" step="any" defaultValue={location?.capacity ?? ""} className="block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          <select name="capacityUom" defaultValue={location?.capacityUom ?? CAPACITY_UOMS[0]} className="block w-24 shrink-0 rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            {CAPACITY_UOMS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
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
          <button onClick={() => setAdding(true)} className="btn btn-primary btn-xs">
            + Add Location
          </button>
        )}
      </div>

      {canEdit && (
        <Modal open={adding} onClose={() => setAdding(false)} title="Add Location">
          <form className="space-y-3" action={(fd) => submit(fd, () => setAdding(false))}>
            <LocationFields />
            {error && <div className="text-sm text-[var(--status-critical)]">{error}</div>}
            <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
              {pending ? "Saving…" : "Save Location"}
            </button>
          </form>
        </Modal>
      )}

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-soft">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Name</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Type</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted">Capacity</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted">Current Stock</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <Fragment key={l.id}>
                <tr className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                  <td className="px-3 py-2.5 text-sm text-foreground">{l.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{l.type}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular text-muted">{l.capacity != null ? `${formatNumber(l.capacity)}${l.capacityUom ? ` ${l.capacityUom}` : ""}` : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular text-muted">{formatStock(l)}</td>
                  <td className="px-3 py-2.5">
                    {canEdit ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingId(editingId === l.id ? null : l.id)}
                          title={editingId === l.id ? "Close" : "Edit"}
                          aria-label={editingId === l.id ? "Close edit form" : "Edit location"}
                          className="rounded p-1.5 text-muted hover:bg-surface-raised hover:text-accent"
                        >
                          <EditIcon />
                        </button>
                        <button
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("id", l.id);
                            setError(null);
                            startTransition(async () => {
                              const res = await actionDeleteLocation(fd);
                              if (!res.ok) setError(res.error ?? "Failed");
                            });
                          }}
                          disabled={pending}
                          title="Delete"
                          aria-label="Delete location"
                          className="rounded p-1.5 text-muted hover:bg-[var(--status-critical-bg)] hover:text-[var(--status-critical)] disabled:opacity-40"
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-soft">—</span>
                    )}
                  </td>
                </tr>
                {canEdit && editingId === l.id && (
                  <tr className="border-b border-border-soft">
                    <td colSpan={5} className="bg-surface-raised px-3 py-3">
                      <form className="space-y-3" action={(fd) => submit(fd, () => setEditingId(null))}>
                        <input type="hidden" name="id" value={l.id} />
                        <LocationFields location={l} />
                        {error && <div className="text-sm text-[var(--status-critical)]">{error}</div>}
                        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
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
