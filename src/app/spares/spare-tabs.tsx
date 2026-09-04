"use client";

import { useMemo, useState } from "react";
import { Th, Td, EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { formatNumber } from "@/lib/format";
import { RequestListRow } from "@/app/requests/request-list-row";
import { MaterialsManager } from "@/app/materials/materials-manager";
import { SPARE_CRITICALITIES, STOCK_STATUSES } from "@/lib/domain/enums";

type InventoryRow = {
  materialId: string; code: string; name: string; uom: string;
  equipmentRef: string | null; criticality: string;
  onHand: number; reserved: number; available: number; qcHold: number; blocked: number;
  minStock: number | null; safetyStock: number | null; status: string;
  locationBreakdown: { id: string; name: string; quantity: number }[];
};
type Location = { id: string; name: string };
type Person = { id: string; name: string };
type RequestRow = {
  id: string; requestNumber: string; materialName: string; purpose: string; uom: string; quantityRequested: number;
  requestedByName: string; assignedToName: string | null; routedToName: string | null;
  requiredByDate: Date; status: string;
  isRoutedSupervisor: boolean; isAssignedOperator: boolean; isRequester: boolean;
  deliveredNotYetReceived: number;
};
type MasterMaterial = {
  id: string; materialCode: string; name: string; category: string; uom: string;
  minStock: number | null; safetyStock: number | null; defaultLocationId: string | null; active: boolean;
  partNumber: string | null; manufacturer: string | null; equipmentRef: string | null; criticality: string | null;
};

const TABS = [
  { key: "inventory", label: "Spare Inventory" },
  { key: "requests", label: "Spare Requests" },
  { key: "master", label: "Spare Master" },
] as const;

export function SpareTabs({
  inventoryRows,
  locations,
  requestRows,
  canAcceptReject,
  canRoute,
  canAssignOperator,
  supervisors,
  operators,
  masterMaterials,
  masterLocations,
  canManageMasterData,
}: {
  inventoryRows: InventoryRow[];
  locations: Location[];
  requestRows: RequestRow[];
  canAcceptReject: boolean;
  canRoute: boolean;
  canAssignOperator: boolean;
  supervisors: Person[];
  operators: Person[];
  masterMaterials: MasterMaterial[];
  masterLocations: Location[];
  canManageMasterData: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("inventory");
  const [search, setSearch] = useState("");
  const [criticality, setCriticality] = useState("");
  const [locationId, setLocationId] = useState("");
  const [status, setStatus] = useState("");

  const filteredInventory = useMemo(
    () =>
      inventoryRows.filter((r) => {
        const q = search.trim().toLowerCase();
        if (q && !r.name.toLowerCase().includes(q) && !r.code.toLowerCase().includes(q)) return false;
        if (criticality && r.criticality !== criticality) return false;
        if (locationId && !r.locationBreakdown.some((b) => b.id === locationId)) return false;
        if (status && r.status !== status) return false;
        return true;
      }),
    [inventoryRows, search, criticality, locationId, status]
  );

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

      {tab === "inventory" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="text-xs text-muted">
              Search
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or code…" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
            </label>
            <label className="text-xs text-muted">
              Criticality
              <select value={criticality} onChange={(e) => setCriticality(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                <option value="">All</option>
                {SPARE_CRITICALITIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Location
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                <option value="">All</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
                <option value="">All</option>
                {STOCK_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          {filteredInventory.length === 0 ? (
            <EmptyState title="No spares match these filters" />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border-soft">
                    <Th>Spare</Th>
                    <Th>Equipment</Th>
                    <Th>Location(s)</Th>
                    <Th className="text-right">On Hand</Th>
                    <Th className="text-right">Reserved</Th>
                    <Th className="text-right">Available</Th>
                    <Th className="text-right">QC Hold</Th>
                    <Th className="text-right">Blocked</Th>
                    <Th className="text-right">Min</Th>
                    <Th className="text-right">Safety</Th>
                    <Th>Status</Th>
                    <Th>Criticality</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map((r) => (
                    <tr key={r.materialId} className="border-b border-border-soft last:border-0">
                      <Td>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-soft">{r.code}</div>
                      </Td>
                      <Td className="text-xs text-muted">{r.equipmentRef ?? "—"}</Td>
                      <Td className="text-xs text-muted">
                        {r.locationBreakdown.length === 0 ? (
                          "—"
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {r.locationBreakdown.map((b) => (
                              <div key={b.id} className="whitespace-nowrap">
                                <span className="text-foreground">{b.name}</span>
                                <span className="text-muted-soft"> — {formatNumber(b.quantity)} {r.uom}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </Td>
                      <Td className="text-right tabular">{formatNumber(r.onHand)} {r.uom}</Td>
                      <Td className="text-right tabular text-muted">{formatNumber(r.reserved)} {r.uom}</Td>
                      <Td className="text-right tabular">{formatNumber(r.available)} {r.uom}</Td>
                      <Td className="text-right tabular text-muted">{r.qcHold > 0 ? formatNumber(r.qcHold) : "—"}</Td>
                      <Td className="text-right tabular text-muted">{r.blocked > 0 ? formatNumber(r.blocked) : "—"}</Td>
                      <Td className="text-right tabular text-muted">{r.minStock != null ? formatNumber(r.minStock) : "—"}</Td>
                      <Td className="text-right tabular text-muted">{r.safetyStock != null ? formatNumber(r.safetyStock) : "—"}</Td>
                      <Td><StatusBadge status={r.status as never} /></Td>
                      <Td className="text-xs text-muted">{r.criticality}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "requests" &&
        (requestRows.length === 0 ? (
          <EmptyState title="No spare requests yet" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Request ID</Th>
                  <Th>Spare</Th>
                  <Th>Purpose</Th>
                  <Th className="text-right">Qty</Th>
                  <Th>Requested By</Th>
                  <Th>Assigned To</Th>
                  <Th>Required By</Th>
                  <Th>Status</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {requestRows.map((r) => (
                  <RequestListRow
                    key={r.id}
                    id={r.id}
                    requestNumber={r.requestNumber}
                    materialName={r.materialName}
                    purpose={r.purpose}
                    uom={r.uom}
                    quantityRequested={r.quantityRequested}
                    requestedByName={r.requestedByName}
                    assignedToName={r.assignedToName}
                    routedToName={r.routedToName}
                    requiredByDate={r.requiredByDate}
                    status={r.status}
                    canAcceptReject={canAcceptReject}
                    canRoute={canRoute}
                    canAssignOperator={canAssignOperator}
                    isRoutedSupervisor={r.isRoutedSupervisor}
                    isAssignedOperator={r.isAssignedOperator}
                    isRequester={r.isRequester}
                    supervisors={supervisors}
                    operators={operators}
                    deliveredNotYetReceived={r.deliveredNotYetReceived}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "master" && <MaterialsManager materials={masterMaterials} locations={masterLocations} canEdit={canManageMasterData} />}
    </div>
  );
}
