import Link from "next/link";
import type { ReactNode } from "react";
import { Panel, Th, Td, EmptyState, ViewIcon } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import type { AttentionItem } from "@/lib/inventory/dashboard";

type Tone = "critical" | "warning" | "transit" | "healthy" | "exception";

// Literal (non-interpolated) class strings per tone — Tailwind's scanner needs the whole
// class name to appear verbatim in the source, so this can't be built with a template literal.
const TONE_STYLES: Record<Tone, { fg: string; bg: string; iconBg: string }> = {
  critical: { fg: "text-[var(--status-critical)]", bg: "bg-[var(--status-critical-bg)]", iconBg: "bg-[var(--status-critical-bg)]" },
  warning: { fg: "text-[var(--status-warning)]", bg: "bg-[var(--status-warning-bg)]", iconBg: "bg-[var(--status-warning-bg)]" },
  transit: { fg: "text-[var(--status-transit)]", bg: "bg-[var(--status-transit-bg)]", iconBg: "bg-[var(--status-transit-bg)]" },
  healthy: { fg: "text-[var(--status-healthy)]", bg: "bg-[var(--status-healthy-bg)]", iconBg: "bg-[var(--status-healthy-bg)]" },
  exception: { fg: "text-[var(--status-exception)]", bg: "bg-[var(--status-exception-bg)]", iconBg: "bg-[var(--status-exception-bg)]" },
};

const KPI_ICON: Record<Tone, ReactNode> = {
  critical: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4" /><path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  ),
  healthy: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="14" height="12" rx="1.5" /><path d="M7 3.5h6" /><path d="M9 11h4" /><path d="M9 15h4" />
    </svg>
  ),
  transit: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8h13v9H1z" /><path d="M14 11h4l4 3v3h-8z" />
      <circle cx="6" cy="19" r="1.8" /><circle cx="17.5" cy="19" r="1.8" />
    </svg>
  ),
  exception: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" />
    </svg>
  ),
};

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function StatCard({
  tone, label, value, unit, href, sublabel,
}: {
  tone: Tone;
  label: string;
  value: number;
  unit: string;
  href: string;
  sublabel?: string;
}) {
  const s = TONE_STYLES[tone];
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-2 rounded-lg border border-transparent ${s.bg} p-2.5 transition-transform hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${s.iconBg} ${s.fg}`}>{KPI_ICON[tone]}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
        <div className="flex items-baseline gap-1">
          <span className={`text-lg font-bold tabular leading-none ${s.fg}`}>{formatNumber(value)}</span>
          <span className="text-[10px] font-medium text-muted-soft">{unit}</span>
        </div>
        {sublabel && <div className="truncate text-[10px] text-muted-soft">{sublabel}</div>}
      </div>
      <span className={`absolute right-2 top-2 ${s.fg} opacity-0 transition-opacity group-hover:opacity-100`}><ChevronRightIcon /></span>
    </Link>
  );
}

// One row per item (matching the table density of Stock Requiring Attention right below it).
// Every item here is CRITICAL (the app has only HEALTHY/CRITICAL — see classifyStockStatus).
export function NeedsAttentionPanel({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <Panel title="Needs Attention">
        <EmptyState title="Nothing needs attention" body="All materials are above their minimum stock." />
      </Panel>
    );
  }
  return (
    <Panel title="Needs Attention" action={<Link href="/inventory?status=CRITICAL" className="text-xs text-accent hover:underline">View all →</Link>}>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-soft">
              <Th>Material</Th>
              <Th className="text-right">Available</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 5).map((item, i) => (
              <tr key={i} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                <Td className="font-medium">{item.title}</Td>
                <Td className="text-right tabular">{item.line1}</Td>
                <Td>
                  <span className="inline-flex rounded-full bg-[var(--status-critical-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-critical)]">{item.badgeLabel}</span>
                </Td>
                <Td>
                  <Link href={item.href} title="View details" aria-label={`View details for ${item.title}`} className="inline-flex rounded p-1.5 text-muted hover:bg-surface-raised hover:text-accent">
                    <ViewIcon />
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const REQUEST_STATUS_DOT: Record<string, string> = {
  NEW_REQUEST: "bg-[var(--status-transit)]",
  ACCEPTED: "bg-[var(--status-healthy)]",
  ASSIGNED: "bg-[var(--status-warning)]",
  IN_TRANSIT: "bg-[var(--status-excess)]",
  DELIVERED: "bg-[var(--status-healthy)]",
  NOT_RECEIVED: "bg-[var(--status-critical)]",
  PARTIALLY_RECEIVED: "bg-[var(--status-warning)]",
};

export function RequestStatusPanel({ rows }: { rows: { status: string; label: string; count: number }[] }) {
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel title="Request Status">
      {rows.length === 0 ? (
        <EmptyState title="No open requests" />
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.status}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground">{r.label}</span>
                <span className="tabular text-muted">{r.count}</span>
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
                <div
                  className={`h-full rounded-full ${REQUEST_STATUS_DOT[r.status] ?? "bg-muted"}`}
                  style={{ width: `${(r.count / maxCount) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <Link href="/requests" className="mt-2 block text-xs text-accent hover:underline">
        View all requests →
      </Link>
    </Panel>
  );
}

