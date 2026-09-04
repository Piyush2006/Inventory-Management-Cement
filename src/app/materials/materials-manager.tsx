"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { actionSaveMaterial, actionDeleteMaterial } from "@/app/actions";
import { MATERIAL_CATEGORIES, SPARE_CRITICALITIES } from "@/lib/domain/enums";
import { formatNumber } from "@/lib/format";
import { EditIcon, DeleteIcon } from "@/components/ui";
import { Modal } from "@/components/modal";

type Material = {
  id: string; materialCode: string; name: string; category: string; uom: string;
  minStock: number | null; maxStock: number | null; defaultLocationId: string | null;
  partNumber?: string | null; manufacturer?: string | null; equipmentRef?: string | null; criticality?: string | null;
};
type Location = { id: string; name: string };

const NON_SPARE_CATEGORIES = MATERIAL_CATEGORIES.filter((c) => c !== "SPARE");

function MaterialFields({ material, locations }: { material?: Material; locations: Location[] }) {
  // Type (Material/Spare) is a UI-only toggle — not itself submitted — that narrows which
  // Category options are offered, mirroring the New Request form's Type field. Controlled (not
  // just defaultValue) so the Spare-only fields below can toggle live when Type changes, both
  // when adding a new material and when editing an existing one.
  const [type, setType] = useState<"MATERIAL" | "SPARE">(material?.category === "SPARE" ? "SPARE" : "MATERIAL");
  const [category, setCategory] = useState(material?.category && material.category !== "SPARE" ? material.category : NON_SPARE_CATEGORIES[0]);
  const isSpare = type === "SPARE";

  function handleTypeChange(nextType: "MATERIAL" | "SPARE") {
    setType(nextType);
    if (nextType === "MATERIAL") setCategory(NON_SPARE_CATEGORIES[0]);
  }

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
        Type
        <select value={type} onChange={(e) => handleTypeChange(e.target.value as "MATERIAL" | "SPARE")} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
          <option value="MATERIAL">Material</option>
          <option value="SPARE">Spare</option>
        </select>
      </label>
      {isSpare ? (
        <label className="text-xs text-muted">
          Category
          <input value="SPARE" disabled className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-muted-soft outline-none" />
          <input type="hidden" name="category" value="SPARE" />
        </label>
      ) : (
        <label className="text-xs text-muted">
          Category
          <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            {NON_SPARE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.replace("_", " ")}</option>
            ))}
          </select>
        </label>
      )}
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
        Max stock
        <input name="maxStock" type="number" step="any" defaultValue={material?.maxStock ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>
      {isSpare && (
        <>
          <label className="text-xs text-muted">
            Part number
            <input name="partNumber" defaultValue={material?.partNumber ?? ""} placeholder="e.g. 6205-2RS" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Manufacturer
            <input name="manufacturer" defaultValue={material?.manufacturer ?? ""} placeholder="e.g. SKF" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Equipment / Asset
            <input name="equipmentRef" defaultValue={material?.equipmentRef ?? ""} placeholder="e.g. Conveyor C-102" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Criticality
            <select name="criticality" defaultValue={material?.criticality ?? "NORMAL"} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              {SPARE_CRITICALITIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

export function MaterialsManager({ materials, locations, canEdit }: { materials: Material[]; locations: Location[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategoryFilter] = useState("");
  const visibleMaterials = useMemo(() => (category ? materials.filter((m) => m.category === category) : materials), [materials, category]);

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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted">{visibleMaterials.length} materials</div>
          <select
            value={category}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent"
          >
            <option value="">All categories</option>
            {MATERIAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.replace("_", " ")}</option>
            ))}
          </select>
        </div>
        {canEdit && (
          <button onClick={() => setAdding(true)} className="btn btn-primary btn-xs">
            + Add Material
          </button>
        )}
      </div>

      {canEdit && (
        <Modal open={adding} onClose={() => setAdding(false)} title="Add Material">
          <form className="space-y-3" action={(fd) => submit(fd, () => setAdding(false))}>
            <MaterialFields locations={locations} />
            {error && <div className="text-sm text-[var(--status-critical)]">{error}</div>}
            <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
              {pending ? "Saving…" : "Save Material"}
            </button>
          </form>
        </Modal>
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
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted">Max</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleMaterials.map((m) => (
              <Fragment key={m.id}>
                <tr className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                  <td className="px-3 py-2.5 text-sm text-muted-soft">{m.materialCode}</td>
                  <td className="px-3 py-2.5 text-sm text-foreground">{m.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{m.category.replace("_", " ")}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{m.uom}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular text-muted">{m.minStock != null ? formatNumber(m.minStock) : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular text-muted">{m.maxStock != null ? formatNumber(m.maxStock) : "—"}</td>
                  <td className="px-3 py-2.5">
                    {canEdit ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                          title={editingId === m.id ? "Close" : "Edit"}
                          aria-label={editingId === m.id ? "Close edit form" : "Edit material"}
                          className="rounded p-1.5 text-muted hover:bg-surface-raised hover:text-accent"
                        >
                          <EditIcon />
                        </button>
                        <button
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("id", m.id);
                            setError(null);
                            startTransition(async () => {
                              const res = await actionDeleteMaterial(fd);
                              if (!res.ok) setError(res.error ?? "Failed to delete material");
                            });
                          }}
                          disabled={pending}
                          title="Delete"
                          aria-label="Delete material"
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
                {canEdit && editingId === m.id && (
                  <tr className="border-b border-border-soft">
                    <td colSpan={7} className="bg-surface-raised px-3 py-3">
                      <form className="space-y-3" action={(fd) => submit(fd, () => setEditingId(null))}>
                        <input type="hidden" name="id" value={m.id} />
                        <MaterialFields material={m} locations={locations} />
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
      {error && !adding && editingId === null && <div className="text-sm text-[var(--status-critical)]">{error}</div>}
    </div>
  );
}
