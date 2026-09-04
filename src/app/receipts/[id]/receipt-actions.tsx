"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actionPostMaterialReceipt, actionCancelMaterialReceipt } from "@/app/actions";

export function ReceiptActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "cancel">("idle");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  if (status === "CANCELLED") return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && (
          <button
            onClick={() =>
              startTransition(async () => {
                const fd = new FormData();
                fd.set("id", id);
                const res = await actionPostMaterialReceipt(fd);
                setResult(res);
                if (res.ok) router.refresh();
              })
            }
            disabled={pending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40"
          >
            {pending ? "Posting…" : "Post GRN"}
          </button>
        )}
        <button onClick={() => setMode(mode === "cancel" ? "idle" : "cancel")} className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-foreground">
          {mode === "cancel" ? "Close" : status === "POSTED" ? "Cancel Receipt (reverses stock)" : "Cancel Draft"}
        </button>
      </div>
      {result && !result.ok && <div className="text-sm text-[var(--status-critical)]">{result.error}</div>}

      {mode === "cancel" && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--status-critical)]/25 bg-[var(--status-critical-bg)] p-3"
          action={(fd) => {
            startTransition(async () => {
              const res = await actionCancelMaterialReceipt(fd);
              setResult(res);
              if (res.ok) {
                setMode("idle");
                router.refresh();
              }
            });
          }}
        >
          <input type="hidden" name="id" value={id} />
          <input name="reason" required placeholder="Reason (required)…" className="w-56 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          <button type="submit" disabled={pending} className="rounded-md bg-[var(--status-critical-solid)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {pending ? "Cancelling…" : "Confirm Cancellation"}
          </button>
        </form>
      )}
    </div>
  );
}
