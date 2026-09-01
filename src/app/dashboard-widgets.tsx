import Image from "next/image";
import Link from "next/link";
import { Panel, Th, Td, EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { formatNumber } from "@/lib/format";
import type { AttentionItem } from "@/lib/inventory/dashboard";

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
    <Link href={href} className="shadow-panel block rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/40">
      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${s.badgeBg}`}>
        <Image src={ICON[icon]} alt="" width={22} height={22} />
      </div>
      <div className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular text-foreground">{formatNumber(value)}</div>
      <div className="text-xs text-muted-soft">{unit}</div>
      <div className={`mt-2 text-xs font-medium ${s.badgeFg}`}>View all →</div>
    </Link>
  );
}

const ATTENTION_ICON: Record<AttentionItem["kind"], keyof typeof ICON> = { critical: "critical", low: "low", exception: "exception" };
const ATTENTION_TONE: Record<AttentionItem["kind"], Tone> = { critical: "critical", low: "warning", exception: "exception" };

export function NeedsAttentionPanel({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <Panel title="Needs Attention">
        <EmptyState title="Nothing needs attention" body="All materials healthy, no request exceptions open." />
      </Panel>
    );
  }
  return (
    <Panel title="Needs Attention" action={<Link href="/requests" className="text-xs text-accent hover:underline">View all →</Link>}>
      <div className="space-y-2">
        {items.map((item, i) => {
          const s = TONE_STYLES[ATTENTION_TONE[item.kind]];
          return (
            <div key={`${item.kind}-${i}`} className={`flex items-center justify-between gap-3 rounded-md ${s.badgeBg} px-3 py-2.5`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${s.badgeBg} border border-border-soft`}>
                  <Image src={ICON[ATTENTION_ICON[item.kind]]} alt="" width={16} height={16} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                  <div className="truncate text-xs text-muted-soft">{item.subtitle}</div>
                </div>
              </div>
              <div className="hidden shrink-0 text-right sm:block">
                <div className="text-sm text-foreground">{item.line1}</div>
                <div className="text-xs text-muted-soft">{item.line2}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${s.badgeFg} ${s.badgeBg}`}>{item.badgeLabel}</span>
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

export function StockWatchlistPanel({ rows }: { rows: { material: { id: string; name: string; uom: string }; currentStock: number; status: "HEALTHY" | "LOW" | "CRITICAL"; daysCover: number }[] }) {
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
                <Th className="text-right">Stock</Th>
                <Th>Status</Th>
                <Th className="text-right">Days Cover</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.material.id} className="border-b border-border-soft last:border-0">
                  <Td>
                    <Link href={`/inventory/${r.material.id}`} className="hover:text-accent">{r.material.name}</Link>
                  </Td>
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
