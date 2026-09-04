"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Th, Td, EmptyState } from "@/components/ui";
import { Modal } from "@/components/modal";
import { SpareReturnReportForm } from "./spare-return-report-form";
import { formatNumber, formatDateTime } from "@/lib/format";

type ReturnRow = {
  id: string;
  returnReference: string;
  quantity: number;
  status: string;
  condition: string | null;
  createdAt: Date;
};

export function SpareReturnReportPanel({
  requestId,
  remaining,
  uom,
  defaultReturnedBy,
  returns,
}: {
  requestId: string;
  remaining: number;
  uom: string;
  defaultReturnedBy: string;
  returns: ReturnRow[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-soft">{formatNumber(remaining)} {uom} still eligible to return.</p>
        <button type="button" onClick={() => setCreating(true)} disabled={remaining <= 0} className="btn btn-secondary btn-sm disabled:opacity-40">
          + Report Return
        </button>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Report Spare Return">
        <SpareReturnReportForm
          requestId={requestId}
          remaining={remaining}
          uom={uom}
          defaultReturnedBy={defaultReturnedBy}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      </Modal>

      {returns.length === 0 ? (
        <EmptyState title="No returns reported yet" />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-soft">
                <Th>Return Ref</Th>
                <Th className="text-right">Qty</Th>
                <Th>Status</Th>
                <Th>Condition</Th>
                <Th>Date</Th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                  <Td className="text-xs text-muted-soft">{r.returnReference}</Td>
                  <Td className="text-right tabular">{formatNumber(r.quantity)} {uom}</Td>
                  <Td>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${r.status === "COMPLETED" ? "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]" : "text-[var(--status-warning)] bg-[var(--status-warning-bg)]"}`}>
                      {r.status === "COMPLETED" ? "Completed" : "Reported — pending"}
                    </span>
                  </Td>
                  <Td className="text-xs text-muted">{r.condition?.replace("_", " ") ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(r.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
