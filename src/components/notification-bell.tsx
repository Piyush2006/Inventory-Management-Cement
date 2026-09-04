"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { actionMarkNotificationRead } from "@/app/actions";

type BellNotification = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  type: string;
  link: string | null;
  createdAt: string; // pre-formatted, server-rendered
};

export function NotificationBell({ notifications, unreadCount }: { notifications: BellNotification[]; unreadCount: number }) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function markRead(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(() => {
      actionMarkNotificationRead(fd);
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        title="Notifications"
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--status-critical-solid)] px-1 text-[10px] font-medium leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-20 w-80 rounded-lg border border-border bg-surface shadow-panel">
          <div className="flex items-center justify-between border-b border-border-soft px-3 py-2">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && <span className="text-xs text-muted-soft">{unreadCount} unread</span>}
          </div>
          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-soft">No notifications yet</div>
            ) : (
              notifications.map((n) => {
                const content = (
                  <div className={`border-b border-border-soft px-3 py-2.5 last:border-0 ${n.read ? "" : "bg-accent-soft/40"}`}>
                    <div className="flex items-start gap-2">
                      {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                      <div className={`min-w-0 ${n.read ? "pl-3.5" : ""}`}>
                        <div className="truncate text-xs font-medium text-foreground">{n.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-muted">{n.message}</div>
                        <div className="mt-1 text-[10px] text-muted-soft">{n.createdAt}</div>
                      </div>
                    </div>
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} href={n.link} onClick={() => !n.read && markRead(n.id)} className="block hover:bg-surface-raised">
                    {content}
                  </Link>
                ) : (
                  <div key={n.id} onClick={() => !n.read && markRead(n.id)} className="cursor-pointer hover:bg-surface-raised">
                    {content}
                  </div>
                );
              })
            )}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-border-soft px-3 py-2 text-center text-xs font-medium text-accent hover:underline">
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
