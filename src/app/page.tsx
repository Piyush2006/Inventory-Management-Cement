import { Suspense } from "react";
import { getDashboardData } from "@/lib/inventory/dashboard";
import { Panel } from "@/components/ui";
import { StatCard, NeedsAttentionPanel, RequestStatusPanel } from "./dashboard-widgets";
import { SiloQuickView } from "@/components/dashboard/silo-quick-view";
import { MaterialFlowChart } from "@/components/dashboard/material-flow-chart";
import { BruceChat } from "@/components/bruce-chat";

export const dynamic = "force-dynamic";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// No restrictToRequestsOnly gate — every non-Requester-exclusive role, Indentor (Requester)
// included, has full read access to the Dashboard. Nothing here is a write action.
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const params = await searchParams;
  const flowStartDate = params.from && ISO_DATE_RE.test(params.from) ? new Date(params.from) : undefined;
  const flowEndDate = params.to && ISO_DATE_RE.test(params.to) ? new Date(params.to) : undefined;
  const data = await getDashboardData(flowStartDate, flowEndDate);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="text-xs text-muted-soft">Real-time overview of inventory, operations and key actions</p>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_380px] xl:items-start">
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard tone="critical" label="Critical Stock" value={data.kpi.criticalCount} unit="Items" href="/inventory?status=CRITICAL" sublabel="Below minimum stock" />
            <StatCard tone="healthy" label="Open Requests" value={data.kpi.openRequestsCount} unit="Requests" href="/requests" sublabel="Awaiting action" />
            <StatCard tone="transit" label="In Transit" value={data.kpi.totalInTransitMt} unit="MT" href="/requests" />
            <StatCard tone="exception" label="Dispatched Today" value={data.kpi.dispatchedTodayMt} unit="MT" href="/movements?tab=DISPATCH" />
          </div>

          <Panel title="Inventory Movement">
            <Suspense fallback={<div className="p-4 text-sm text-muted-soft">Loading…</div>}>
              <MaterialFlowChart
                materials={data.materialFlow.materials}
                defaultMaterialId={data.materialFlow.defaultMaterialId}
                seriesByMaterial={data.materialFlow.seriesByMaterial}
                range={data.materialFlow.range}
              />
            </Suspense>
          </Panel>

          <SiloQuickView silos={data.siloRows} />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <NeedsAttentionPanel items={data.needsAttention} />
            <RequestStatusPanel rows={data.requestsByStatus} />
          </div>
        </div>

        <div className="space-y-3 xl:sticky xl:top-6">
          <BruceChat />
        </div>
      </div>
    </div>
  );
}
