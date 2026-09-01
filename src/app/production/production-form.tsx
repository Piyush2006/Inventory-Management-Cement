"use client";

import { useMemo, useState, useTransition } from "react";
import { actionRecordProduction } from "@/app/actions";
import { formatNumber } from "@/lib/format";

type Material = { id: string; name: string; uom: string; defaultLocationId: string | null };
type Location = { id: string; name: string };
type Coefficient = { outputMaterialId: string; inputMaterialId: string; inputName: string; rate: number };

export function ProductionForm({ outputs, locations, coefficients }: { outputs: Material[]; locations: Location[]; coefficients: Coefficient[] }) {
  const [outputMaterialId, setOutputMaterialId] = useState(outputs[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string; consumedInputs?: { materialName: string; quantity: number }[] } | null>(null);

  const output = outputs.find((m) => m.id === outputMaterialId);
  const relevantCoefficients = useMemo(() => coefficients.filter((c) => c.outputMaterialId === outputMaterialId), [coefficients, outputMaterialId]);
  const qtyNum = Number(quantity);
  const preview = !Number.isNaN(qtyNum) && qtyNum > 0 ? relevantCoefficients.map((c) => ({ name: c.inputName, quantity: c.rate * qtyNum })) : [];

  return (
    <form
      className="space-y-3"
      action={(fd) => {
        setResult(null);
        startTransition(async () => {
          const res = await actionRecordProduction(fd);
          setResult(res);
          if (res.ok) setQuantity("");
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted">
          Output material
          <select name="outputMaterialId" value={outputMaterialId} onChange={(e) => setOutputMaterialId(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            {outputs.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Quantity {output ? `(${output.uom})` : ""}
          <input name="quantity" type="number" step="any" min="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
        <label className="text-xs text-muted">
          Output location
          <select name="outputLocationId" defaultValue={output?.defaultLocationId ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-xs text-muted">
        Note (optional)
        <input name="note" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>
      <input type="hidden" name="processName" value={output?.name.includes("Cement") ? "Cement Mill" : output?.name === "Clinker" ? "Kiln" : "Raw Mill"} />

      {preview.length > 0 && (
        <div className="rounded-md border border-border-soft bg-surface-raised px-3 py-2 text-xs">
          <div className="mb-1 font-medium text-muted-soft">Will automatically consume:</div>
          <ul className="space-y-0.5">
            {preview.map((p) => (
              <li key={p.name} className="flex justify-between text-muted">
                <span>{p.name}</span>
                <span className="tabular text-foreground">{formatNumber(p.quantity, 1)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && !result.ok && <div className="text-sm text-[var(--status-critical)]">{result.error}</div>}
      {result?.ok && (
        <div className="text-sm text-[var(--status-healthy)]">
          Production recorded.{result.consumedInputs?.length ? ` Consumed: ${result.consumedInputs.map((c) => `${formatNumber(c.quantity, 1)} ${c.materialName}`).join(", ")}.` : ""}
        </div>
      )}

      <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
        {pending ? "Recording…" : "Record Production"}
      </button>
    </form>
  );
}
