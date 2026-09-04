"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actionLogout } from "@/app/actions";
import { ROLE_LABELS, type UserRole } from "@/lib/domain/enums";

export function UserProfileMenu({ user }: { user: { name: string; role: string } }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const roleLabel = ROLE_LABELS[user.role as UserRole] ?? user.role;

  function logout() {
    startTransition(async () => {
      await actionLogout();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-surface-raised"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">
          {user.name.charAt(0).toUpperCase()}
        </span>
        <span className="whitespace-nowrap">{user.name} — {roleLabel}</span>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-soft">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-20 w-48 rounded-lg border border-border bg-surface shadow-panel">
          <div className="border-b border-border-soft px-3 py-2.5">
            <div className="text-sm font-medium text-foreground">{user.name}</div>
            <div className="text-xs text-muted-soft">{roleLabel}</div>
          </div>
          <div className="py-1">
            <div className="cursor-default select-none px-3 py-1.5 text-xs text-muted-soft">Profile</div>
            <div className="cursor-default select-none px-3 py-1.5 text-xs text-muted-soft">Settings</div>
            <button
              type="button"
              onClick={logout}
              disabled={pending}
              className="block w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-raised disabled:opacity-40"
            >
              {pending ? "Logging out…" : "Logout"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
