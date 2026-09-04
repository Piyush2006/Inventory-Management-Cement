"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { CloseIcon } from "@/components/ui";

// Shared popup container for every "+ Add X" / "+ New X" creation form in the app — these used
// to expand inline in the page; this renders the exact same form content in an overlay instead.
// Closes on Escape, on backdrop click, or via the X — same three exits every consumer already
// had via its own "Cancel"/"Close" button, which stays inside as the form's own control.
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px] animate-[fade-in_0.15s_ease]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-2xl origin-center animate-[modal-in_0.15s_ease] overflow-y-auto rounded-lg border border-border bg-surface shadow-[var(--shadow-md)] scrollbar-thin">
        {title && (
          <div className="sticky top-0 flex items-center justify-between border-b border-border-soft bg-surface px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <button onClick={onClose} aria-label="Close" title="Close" className="rounded p-1 text-muted hover:bg-surface-raised hover:text-foreground">
              <CloseIcon />
            </button>
          </div>
        )}
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
