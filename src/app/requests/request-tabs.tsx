"use client";

import { useState, type ReactNode } from "react";

export function RequestTabs({
  newRequestContent,
  openContent,
  historyContent,
}: {
  newRequestContent: ReactNode;
  openContent: ReactNode;
  historyContent: ReactNode;
}) {
  const TABS = [
    { key: "new", label: "+ New Request" },
    { key: "open", label: "Open Requests" },
    { key: "history", label: "Request History" },
  ] as const;
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("new");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              tab === t.key ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "new" && newRequestContent}
      {tab === "open" && openContent}
      {tab === "history" && historyContent}
    </div>
  );
}
