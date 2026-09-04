"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { NewRequestForm } from "./new-request-form";

type Material = { id: string; name: string; uom: string };
type SpareMaterial = { id: string; name: string; uom: string; equipmentRef: string | null };
type Location = { id: string; name: string };

export function RequestTabs({
  materials,
  spareMaterials,
  locations,
  openContent,
  historyContent,
}: {
  materials: Material[];
  spareMaterials: SpareMaterial[];
  locations: Location[];
  openContent: ReactNode;
  historyContent: ReactNode;
}) {
  const TABS = [
    { key: "open", label: "Open Requests" },
    { key: "history", label: "Request History" },
  ] as const;
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("open");
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <button type="button" onClick={() => setCreating(true)} className="btn btn-primary btn-sm">
          + New Request
        </button>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New Stock Request">
        <NewRequestForm materials={materials} spareMaterials={spareMaterials} locations={locations} onDone={() => setCreating(false)} />
      </Modal>

      {tab === "open" && openContent}
      {tab === "history" && historyContent}
    </div>
  );
}
