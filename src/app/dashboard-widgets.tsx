import Image from "next/image";
import Link from "next/link";
import { Panel, Th, Td, EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { formatNumber } from "@/lib/format";
import type { AttentionItem } from "@/lib/inventory/dashboard";
import type { InventoryInsight, InsightType } from "@/lib/inventory/insights";

// Icons8 (see MCP server attribution — genuine Icons8 icons, fluent-systems-regular style).
const ICON = {
  critical: "https://img.icons8.com/?id=nBEDJnPNkS3z&format=png&size=48",
  low: "https://img.icons8.com/?id=ZQT2szPyP8Tw&format=png&size=48",
  transit: "https://img.icons8.com/?id=RomUe1vJhggt&format=png&size=48",
  requests: "https://img.icons8.com/?id=OcFpIzWjskp1&format=png&size=48",
  exception: "https://img.icons8.com/?id=aLLIwyHXTTj0&format=png&size=48",
} as const;
type Tone = "critical" | "warning" | "transit" | "healthy" | "exception";

// Literal (non-interpolated) class strings per tone — Tailwind's scanner needs the whole
// class name to appear verbatim in the source, so this can't be built with a template literal.
const TONE_STYLES: Record<Tone, { badgeBg: string; badgeFg: string; dot: string }> = {
  critical: { badgeBg: "bg-[var(--status-critical-bg)]", badgeFg: "text-[var(--status-critical)]", dot: "bg-[var(--status-critical)]" },
  warning: { badgeBg: "bg-[var(--status-warning-bg)]", badgeFg: "text-[var(--status-warning)]", dot: "bg-[var(--status-warning)]" },
  transit: { badgeBg: "bg-[var(--status-transit-bg)]", badgeFg: "text-[var(--status-transit)]", dot: "bg-[var(--status-transit)]" },
  healthy: { badgeBg: "bg-[var(--status-healthy-bg)]", badgeFg: "text-[var(--status-healthy)]", dot: "bg-[var(--status-healthy)]" },
  exception: { badgeBg: "bg-[var(--status-exception-bg)]", badgeFg: "text-[var(--status-exception)]", dot: "bg-[var(--status-exception)]" },
};

export function StatCard({
  icon, tone, label, value, unit, href,
}: {
  icon: keyof typeof ICON;
  tone: Tone;
  label: string;
  value: number;
  unit: string;
  href: string;
}) {
  const s = TONE_STYLES[tone];
  return (
    <Link href={href} className="shadow-panel flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:border-accent/40">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${s.badgeBg}`}>
        <Image src={ICON[icon]} alt="" width={16} height={16} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold tabular leading-tight text-foreground">{formatNumber(value)}</span>
          <span className="truncate text-[11px] text-muted-soft">{unit}</span>
        </div>
      </div>
    </Link>
  );
}

const ATTENTION_ICON: Record<AttentionItem["kind"], keyof typeof ICON> = { critical: "critical", low: "low" };
const ATTENTION_TONE: Record<AttentionItem["kind"], Tone> = { critical: "critical", low: "warning" };

export function NeedsAttentionPanel({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <Panel title="Needs Attention">
        <EmptyState title="Nothing needs attention" body="All materials are above their minimum stock." />
      </Panel>
    );
  }
  return (
    <Panel title="Needs Attention" action={<Link href="/inventory" className="text-xs text-accent hover:underline">View all →</Link>}>
      <div className="space-y-2">
        {items.map((item, i) => {
          const s = TONE_STYLES[ATTENTION_TONE[item.kind]];
          return (
            // flex-1 on the title block absorbs all the variable-length content (title/subtitle,
            // stock figures) so the badge and View button — both fixed-width columns — always
            // land in the same horizontal position from row to row, instead of drifting with
            // justify-between's surplus-space redistribution.
            <div key={`${item.kind}-${i}`} className={`flex items-center gap-3 rounded-md ${s.badgeBg} px-3 py-2.5`}>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${s.badgeBg} border border-border-soft`}>
                  <Image src={ICON[ATTENTION_ICON[item.kind]]} alt="" width={16} height={16} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                  <div className="truncate text-xs text-muted-soft">{item.subtitle}</div>
                </div>
              </div>
              <div className="hidden w-36 shrink-0 text-right sm:block">
                <div className="truncate text-sm text-foreground">{item.line1}</div>
                <div className="truncate text-xs text-muted-soft">{item.line2}</div>
              </div>
              <span className={`w-20 shrink-0 rounded-full px-2.5 py-1 text-center text-xs font-medium ${s.badgeFg} ${s.badgeBg}`}>{item.badgeLabel}</span>
              <Link href={item.href} className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent/50">
                View
              </Link>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

const INSIGHT_DOT: Record<InsightType, string> = {
  HIGH_RISK: "bg-[var(--status-critical)]",
  QUALITY_HOLD_RISK: "bg-[var(--status-exception)]",
  MEDIUM_RISK: "bg-[var(--status-warning)]",
  CONSUMPTION_ANOMALY: "bg-[var(--status-transit)]",
};

/**
 * The Dashboard's Bruce AI insight card — same getInventoryInsights() data the earlier AI
 * Inventory Insights feature already computed (no new risk logic), restyled compact enough for
 * a narrow sidebar rail per the Bruce AI wireframe, and rebranded (the user-facing AI name must
 * be "Bruce AI", not "AI Inventory Insights").
 */
export function BruceInsightCard({
  insights,
  hasConsumptionData,
  unavailable,
}: {
  insights: InventoryInsight[];
  hasConsumptionData: boolean;
  unavailable: boolean;
}) {
  return (
    <div className="shadow-panel rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="text-base">✨</span>
        <span className="text-sm font-semibold text-foreground">Bruce AI</span>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">Beta</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-soft">Inventory Copilot</p>

      {unavailable ? (
        <p className="mt-3 text-sm text-muted-soft">Bruce AI is temporarily unavailable.</p>
      ) : insights.length === 0 ? (
        <p className="mt-3 text-sm text-muted-soft">
          {hasConsumptionData ? "No significant inventory risks detected." : "Insufficient consumption data to estimate risk."}
        </p>
      ) : (
        <>
          <p className="mt-3 text-xs font-medium text-muted">{insights.length} thing{insights.length === 1 ? "" : "s"} need attention today</p>
          <div className="mt-2 space-y-1">
            {insights.map((ins) => (
              <Link
                key={`${ins.materialId}-${ins.type}`}
                href={`/inventory/${ins.materialId}`}
                className="group flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-surface-raised"
              >
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${INSIGHT_DOT[ins.type]}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">{ins.materialName} — {ins.typeLabel}</span>
                  <span className="block truncate text-[11px] text-muted-soft">{ins.metrics[0] ? `${ins.metrics[0].label}: ${ins.metrics[0].value}` : ins.explanation}</span>
                </span>
                <span className="shrink-0 text-muted-soft group-hover:text-accent">›</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const REQUEST_STATUS_DOT: Record<string, string> = {
  NEW_REQUEST: "bg-[var(--status-transit)]",
  ACCEPTED: "bg-[var(--status-healthy)]",
  ASSIGNED: "bg-[var(--status-warning)]",
  IN_TRANSIT: "bg-[var(--status-exception)]",
  DELIVERED: "bg-[var(--status-healthy)]",
  NOT_RECEIVED: "bg-[var(--status-critical)]",
  PARTIALLY_RECEIVED: "bg-[var(--status-warning)]",
};

export function RequestStatusPanel({ rows }: { rows: { status: string; label: string; count: number }[] }) {
  return (
    <Panel title="Request Status">
      {rows.length === 0 ? (
        <EmptyState title="No open requests" />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.status} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-foreground">
                <span className={`h-2 w-2 rounded-full ${REQUEST_STATUS_DOT[r.status] ?? "bg-muted"}`} />
                {r.label}
              </span>
              <span className="tabular text-muted">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/requests" className="mt-4 block text-xs text-accent hover:underline">
        View all requests →
      </Link>
    </Panel>
  );
}

export function StockWatchlistPanel({ rows }: { rows: { material: { id: string; name: string; uom: string; category: string }; currentStock: number; status: "HEALTHY" | "LOW" | "CRITICAL"; daysCover: number }[] }) {
  return (
    <Panel title="Stock Requiring Attention" action={<Link href="/inventory" className="text-xs text-accent hover:underline">View all →</Link>}>
      {rows.length === 0 ? (
        <EmptyState title="No consumption history yet" body="Days of cover needs at least one recorded consumption to estimate a rate." />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-soft">
                <Th>Material</Th>
                <Th>Type</Th>
                <Th className="text-right">Stock</Th>
                <Th>Status</Th>
                <Th className="text-right">Days Cover</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.material.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                  <Td>
                    <Link href={`/inventory/${r.material.id}`} className="hover:text-accent">{r.material.name}</Link>
                  </Td>
                  <Td className="text-xs text-muted">{r.material.category === "SPARE" ? "Spare" : "Material"}</Td>
                  <Td className="text-right tabular">{formatNumber(r.currentStock)} {r.material.uom}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td className="text-right tabular">{r.daysCover.toFixed(0)} days</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
