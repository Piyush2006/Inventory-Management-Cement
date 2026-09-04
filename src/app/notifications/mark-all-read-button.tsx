"use client";

import { useTransition } from "react";
import { actionMarkAllNotificationsRead } from "@/app/actions";

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() => startTransition(async () => { await actionMarkAllNotificationsRead(); })}
      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-accent/50 hover:text-foreground disabled:opacity-40"
    >
      {pending ? "Marking…" : "Mark all read"}
    </button>
  );
}
