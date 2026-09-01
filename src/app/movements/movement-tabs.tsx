"use client";

import { useState } from "react";
import { MovementForm, LEDGER_MOVEMENT_TYPES } from "./movement-form";
import { CountAdjustForm } from "./count-adjust-form";
import type { TransactionType } from "@/lib/domain/enums";

type Material = { id: string; name: string; uom: string };
type Location = { id: string; name: string };
type BalanceRow = { materialId: string; materialName: string; uom: string; locationId: string; locationName: string; quantity: number };

const TABS: { key: TransactionType | "ADJUSTMENT"; label: string }[] = [
  ...LEDGER_MOVEMENT_TYPES.map((t) => ({ key: t.type, label: t.label })),
  { key: "ADJUSTMENT", label: "Adjustment / Physical Count" },
];

export function MovementTabs({ materials, locations, balances }: { materials: Material[]; locations: Location[]; balances: BalanceRow[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("RECEIPT");

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

      {tab === "ADJUSTMENT" ? <CountAdjustForm key="adjustment" balances={balances} /> : <MovementForm key={tab} type={tab} materials={materials} locations={locations} />}
    </div>
  );
}
