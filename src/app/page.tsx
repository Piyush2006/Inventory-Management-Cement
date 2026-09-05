import Link from "next/link";
import { getDashboardData } from "@/lib/inventory/dashboard";
import { Panel } from "@/components/ui";
import { TrendChart } from "@/components/charts/trend-chart";
import { StatCard, NeedsAttentionPanel, RequestStatusPanel } from "./dashboard-widgets";
import { SiloQuickView } from "@/components/dashboard/silo-quick-view";
import { BruceChat } from "@/components/bruce-chat";

export const dynamic = "force-dynamic";

// No restrictToRequestsOnly gate — every non-Requester-exclusive role, Indentor (Requester)
// included, has full read access to the Dashboard. Nothing here is a write action.
export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="text-xs text-muted-soft">Real-time overview of inventory, operations and key actions</p>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_380px] xl:items-start">
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard tone="critical" label="Critical Stock" value={data.kpi.criticalCount} unit="Items" href="/inventory?status=CRITICAL" sublabel="Materials below safe level" />
            <StatCard tone="healthy" label="Open Requests" value={data.kpi.openRequestsCount} unit="Requests" href="/requests" sublabel="Awaiting action" />
            <StatCard tone="transit" label="In Transit" value={data.kpi.totalInTransitMt} unit="MT" href="/requests" />
            <StatCard tone="exception" label="Dispatched Today" value={data.kpi.dispatchedTodayMt} unit="MT" href="/movements?tab=DISPATCH" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel title="Inventory Trend (14 days)" action={<Link href="/reports" className="text-xs text-accent hover:underline">View details →</Link>}>
              <TrendChart data={data.trend} series={[{ dataKey: "stockMt", color: "#3aa0ff", label: "Stock Level", unit: "MT" }]} height={120} />
            </Panel>
            <Panel title="Consumption Trend (14 days)" action={<Link href="/reports" className="text-xs text-accent hover:underline">View details →</Link>}>
              <TrendChart data={data.trend} series={[{ dataKey: "consumptionMt", color: "#f5a623", label: "Consumption", unit: "MT/day" }]} height={120} />
            </Panel>
          </div>

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
