import Link from "next/link";
import { getDashboardData } from "@/lib/inventory/dashboard";
import { KpiTile, Panel, Th, Td, EmptyState, LinkPill } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { TrendChart } from "@/components/charts/trend-chart";
import { formatNumber, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">Berrima Cement Plant — simulated demo data.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Total Inventory" value={`${formatNumber(data.kpi.totalInventoryMt)} MT`} />
        <KpiTile label="Critical Materials" value={data.kpi.criticalCount} tone={data.kpi.criticalCount > 0 ? "critical" : "healthy"} />
        <KpiTile label="Low Stock Materials" value={data.kpi.lowCount} tone={data.kpi.lowCount > 0 ? "warning" : "healthy"} />
        <KpiTile label="Open Stock Requests" value={data.kpi.openRequestsCount} />
      </div>

      <Panel title="Exceptions">
        {data.critical.length === 0 && data.low.length === 0 && data.highFillSilos.length === 0 && data.urgentOpenRequests.length === 0 ? (
          <EmptyState title="Nothing needs attention" body="All materials healthy, no silos near capacity, no urgent open requests." />
        ) : (
          <div className="space-y-2">
            {data.critical.map((r) => (
              <div key={r.material.id} className="flex items-center justify-between rounded-md border border-[var(--status-critical)]/25 bg-[var(--status-critical-bg)] px-3 py-2 text-sm">
                <span className="text-foreground">{r.material.name} — {r.reason}</span>
                <LinkPill href={`/inventory/${r.material.id}`}>View →</LinkPill>
              </div>
            ))}
            {data.low.map((r) => (
              <div key={r.material.id} className="flex items-center justify-between rounded-md border border-[var(--status-warning)]/25 bg-[var(--status-warning-bg)] px-3 py-2 text-sm">
                <span className="text-foreground">{r.material.name} — {r.reason}</span>
                <LinkPill href={`/inventory/${r.material.id}`}>View →</LinkPill>
              </div>
            ))}
            {data.highFillSilos.map((s) => (
              <div key={s.location.id} className="flex items-center justify-between rounded-md border border-[var(--status-warning)]/25 bg-[var(--status-warning-bg)] px-3 py-2 text-sm">
                <span className="text-foreground">{s.location.name} is {s.fillPct.toFixed(0)}% full — approaching capacity</span>
              </div>
            ))}
            {data.urgentOpenRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border border-[var(--status-critical)]/25 bg-[var(--status-critical-bg)] px-3 py-2 text-sm">
                <span className="text-foreground">Urgent request {r.requestNumber} — {r.material.name} ({formatNumber(r.quantityRequested - r.receivedQuantity)} remaining)</span>
                <LinkPill href="/requests">View →</LinkPill>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Inventory Trend (14 days)">
          <TrendChart data={data.trend} dataKey="stockMt" unit="MT" color="#3aa0ff" height={200} />
        </Panel>
        <Panel title="Consumption Trend (14 days)">
          <TrendChart data={data.trend} dataKey="consumptionMt" unit="MT/day" color="#f5a623" height={200} />
        </Panel>
      </div>

      <Panel title="Silo Quick View">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.siloRows.map((s) => (
            <div key={s.location.id} className="rounded-md border border-border-soft bg-surface-raised p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">{s.location.name}</span>
                <StatusBadge status={s.fillPct >= 90 ? "CRITICAL" : s.fillPct >= 75 ? "LOW" : "HEALTHY"} label={`${s.fillPct.toFixed(0)}%`} />
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border-soft">
                <div className={`h-full rounded-full ${s.fillPct >= 90 ? "bg-[var(--status-critical)]" : s.fillPct >= 75 ? "bg-[var(--status-warning)]" : "bg-accent"}`} style={{ width: `${Math.min(100, s.fillPct)}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-muted-soft">
                <span>{formatNumber(s.total)} / {formatNumber(s.location.capacity ?? 0)} MT</span>
                <span>~{s.truckloadsRemaining} truckloads free</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Inventory">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-soft">
                <Th>Material</Th>
                <Th>Category</Th>
                <Th className="text-right">Stock</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {data.materialRows.map((r) => (
                <tr key={r.material.id} className="border-b border-border-soft last:border-0">
                  <Td>{r.material.name}</Td>
                  <Td className="text-xs text-muted">{r.material.category.replace("_", " ")}</Td>
                  <Td className="text-right tabular">
                    {formatNumber(r.currentStock)} {r.material.uom}
                  </Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td>
                    <LinkPill href={`/inventory/${r.material.id}`}>View →</LinkPill>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Recent Movements" action={<Link href="/ledger" className="text-xs text-accent hover:underline">Full ledger →</Link>}>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-soft">
                <Th>Timestamp</Th>
                <Th>Material</Th>
                <Th>Type</Th>
                <Th className="text-right">Quantity</Th>
                <Th>From</Th>
                <Th>To</Th>
              </tr>
            </thead>
            <tbody>
              {data.recentMovements.map((m) => (
                <tr key={m.id} className="border-b border-border-soft last:border-0">
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(m.timestamp)}</Td>
                  <Td>{m.material.name}</Td>
                  <Td className="text-xs text-muted">{m.transactionType.replace("_", " ")}</Td>
                  <Td className="text-right tabular">
                    {formatNumber(m.quantity)} {m.uom}
                  </Td>
                  <Td className="text-xs text-muted">{m.sourceLocation?.name ?? "—"}</Td>
                  <Td className="text-xs text-muted">{m.destinationLocation?.name ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
