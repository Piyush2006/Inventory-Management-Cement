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
      className="btn btn-secondary btn-xs"
    >
      {pending ? "Marking…" : "Mark all read"}
    </button>
  );
}
