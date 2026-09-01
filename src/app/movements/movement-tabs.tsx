"use client";

import { useState } from "react";
import { MovementForm, LEDGER_MOVEMENT_TYPES } from "./movement-form";
import { CountAdjustForm } from "./count-adjust-form";
import { ReceiveMaterialPanel } from "./receive-material-panel";
import type { TransactionType } from "@/lib/domain/enums";

type Material = { id: string; name: string; uom: string };
type Location = { id: string; name: string };
type BalanceRow = { materialId: string; materialName: string; uom: string; locationId: string; locationName: string; quantity: number; tolerancePct: number };
type Receipt = {
  id: string; grnNumber: string; receiptDate: Date; supplierName: string; materialName: string;
  receivedQuantity: number; acceptedQuantity: number; rejectedQuantity: number; status: string;
};

const TABS: { key: TransactionType | "RECEIVE" | "ADJUSTMENT"; label: string }[] = [
  { key: "RECEIVE", label: "Receive Material" },
  ...LEDGER_MOVEMENT_TYPES.map((t) => ({ key: t.type, label: t.label })),
  { key: "ADJUSTMENT", label: "Adjustment" },
];

export function MovementTabs({
  materials,
  locations,
  balances,
  receipts,
  suppliers,
  canRecord,
}: {
  materials: Material[];
  locations: Location[];
  balances: BalanceRow[];
  receipts: Receipt[];
  suppliers: { id: string; name: string }[];
  canRecord: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("RECEIVE");

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

      {tab === "RECEIVE" ? (
        <ReceiveMaterialPanel receipts={receipts} canRecord={canRecord} materials={materials} suppliers={suppliers} />
      ) : tab === "ADJUSTMENT" ? (
        <CountAdjustForm key="adjustment" balances={balances} />
      ) : (
        <MovementForm key={tab} type={tab} materials={materials} locations={locations} />
      )}
    </div>
  );
}
