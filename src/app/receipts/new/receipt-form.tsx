"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actionCreateMaterialReceipt } from "@/app/actions";
import { SupplierPicker } from "../supplier-picker";
import { formatNumber } from "@/lib/format";

type Material = { id: string; name: string; uom: string };
type Location = { id: string; name: string };
type Supplier = { id: string; name: string };
type PurchaseRef = { id: string; poNumber: string; materialId: string; materialName: string; supplierId: string; supplierName: string; orderedQuantity: number; uom: string };

export function ReceiptForm({
  materials,
  locations,
  suppliers,
  purchaseReferences,
  defaultMaterialId,
  defaultPurchaseReferenceId,
  defaultStockRequestId,
}: {
  materials: Material[];
  locations: Location[];
  suppliers: Supplier[];
  purchaseReferences: PurchaseRef[];
  defaultMaterialId?: string;
  defaultPurchaseReferenceId?: string;
  defaultStockRequestId?: string;
}) {
  const router = useRouter();
  const [purchaseReferenceId, setPurchaseReferenceId] = useState(defaultPurchaseReferenceId ?? "");
  const [materialId, setMaterialId] = useState(defaultMaterialId ?? materials[0]?.id ?? "");
  const [received, setReceived] = useState("");
  const [accepted, setAccepted] = useState("");
  const [allowOver, setAllowOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const selectedPo = purchaseReferences.find((p) => p.id === purchaseReferenceId);
  const effectiveMaterialId = selectedPo ? selectedPo.materialId : materialId;
  const material = materials.find((m) => m.id === effectiveMaterialId);

  const receivedNum = Number(received);
  const acceptedNum = Number(accepted);
  const hasQuantities = received !== "" && accepted !== "" && !Number.isNaN(receivedNum) && !Number.isNaN(acceptedNum);
  const rejectedNum = hasQuantities ? Math.max(0, receivedNum - acceptedNum) : null;
  const quantityError = hasQuantities && acceptedNum > receivedNum ? "Accepted cannot exceed received." : null;

  function submit(formData: FormData, mode: "draft" | "post") {
    setResult(null);
    formData.set("mode", mode);
    if (selectedPo) {
      formData.set("materialId", selectedPo.materialId);
      formData.set("supplierId", selectedPo.supplierId);
    }
    startTransition(async () => {
      const res = await actionCreateMaterialReceipt(formData);
      setResult(res);
      if (res.ok && "receiptId" in res) router.push(`/receipts/${res.receiptId}`);
    });
  }

  return (
    <form className="space-y-6">
      {defaultStockRequestId && <input type="hidden" name="stockRequestId" value={defaultStockRequestId} />}
      <input type="hidden" name="purchaseReferenceId" value={selectedPo?.id ?? ""} />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-soft">1. Source</h2>
        <label className="block text-xs text-muted">
          Purchase / Source Reference (optional)
          <select
            value={purchaseReferenceId}
            onChange={(e) => setPurchaseReferenceId(e.target.value)}
            className="mt-1 block w-full max-w-md rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            <option value="">No PO — direct receipt</option>
            {purchaseReferences.map((p) => (
              <option key={p.id} value={p.id}>
                {p.poNumber} — {p.materialName} — {p.supplierName} ({formatNumber(p.orderedQuantity)} {p.uom} ordered)
              </option>
            ))}
          </select>
        </label>

        {selectedPo ? (
          <div className="rounded-md border border-border-soft bg-surface-raised px-3 py-2 text-sm text-muted">
            Material: <span className="text-foreground">{selectedPo.materialName}</span> &middot; Supplier: <span className="text-foreground">{selectedPo.supplierName}</span> &middot; Ordered: <span className="text-foreground">{formatNumber(selectedPo.orderedQuantity)} {selectedPo.uom}</span>
          </div>
        ) : (
          <>
            <SupplierPicker suppliers={suppliers} />
            <label className="block text-xs text-muted">
              Material
              <select name="materialId" value={materialId} onChange={(e) => setMaterialId(e.target.value)} required className="mt-1 block w-full max-w-md rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-soft">2. Receipt Details</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted">
            Receipt date
            <input name="receiptDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Destination location
            <select name="destinationLocationId" defaultValue="" required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              <option value="">Select…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Batch / Lot (optional)
            <input name="batchLot" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-soft">3. Quantities {material ? `(${material.uom})` : ""}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted">
            Received quantity
            <input name="receivedQuantity" type="number" step="any" min="0.01" value={received} onChange={(e) => setReceived(e.target.value)} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Accepted quantity
            <input name="acceptedQuantity" type="number" step="any" min="0" value={accepted} onChange={(e) => setAccepted(e.target.value)} required className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <div className="text-xs text-muted">
            Rejected quantity (auto)
            <div className="mt-1 rounded-md border border-border-soft bg-surface px-2.5 py-1.5 text-sm tabular text-foreground">
              {rejectedNum != null ? formatNumber(rejectedNum) : "—"}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-soft">Inventory increases by the accepted quantity only — never ordered or received.</p>
        {quantityError && <div className="text-sm text-[var(--status-critical)]">{quantityError}</div>}
        {selectedPo && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" name="allowOverReceipt" checked={allowOver} onChange={(e) => setAllowOver(e.target.checked)} className="h-4 w-4 rounded border-border" />
            Allow over-receipt beyond the ordered quantity on {selectedPo.poNumber}
          </label>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-soft">4. Invoice & Delivery Documents (optional)</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted">
            Invoice / Bill number
            <input name="invoiceNumber" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Invoice date
            <input name="invoiceDate" type="date" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Invoice amount
            <input name="invoiceAmount" type="number" step="any" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Delivery note number
            <input name="deliveryNoteNumber" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Supplier challan
            <input name="supplierChallan" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Vehicle / weighbridge reference
            <input name="vehicleReference" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Truck number
            <input name="truckNumber" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
        </div>
      </section>

      <label className="block text-xs text-muted">
        Notes
        <textarea name="notes" rows={2} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
      </label>

      {result && !result.ok && <div className="text-sm text-[var(--status-critical)]">{result.error}</div>}

      <div className="flex items-center gap-2 border-t border-border-soft pt-4">
        <button type="submit" formAction={(fd) => submit(fd, "draft")} disabled={pending || !!quantityError} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-accent/50 disabled:opacity-40">
          {pending ? "Saving…" : "Save as Draft"}
        </button>
        <button type="submit" formAction={(fd) => submit(fd, "post")} disabled={pending || !!quantityError} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40">
          {pending ? "Posting…" : "Post GRN"}
        </button>
        <span className="text-xs text-muted-soft">A draft never changes stock — only posting does.</span>
      </div>
    </form>
  );
}
