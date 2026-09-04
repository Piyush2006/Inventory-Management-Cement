import type { ReactNode } from "react";
import Link from "next/link";

export function Panel({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`shadow-panel rounded-lg border border-border bg-surface ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function KpiTile({
  label, value, sublabel, tone = "default", info,
}: {
  label: string; value: ReactNode; sublabel?: ReactNode; tone?: "default" | "critical" | "warning" | "healthy"; info?: ReactNode;
}) {
  const toneClass =
    tone === "critical" ? "text-[var(--status-critical)]" : tone === "warning" ? "text-[var(--status-warning)]" : tone === "healthy" ? "text-[var(--status-healthy)]" : "text-foreground";
  return (
    <div className="shadow-panel rounded-lg border border-border bg-surface px-4 py-3.5 transition-colors">
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted">
        <span>{label}</span>
        {info}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tabular ${toneClass}`}>{value}</div>
      {sublabel && <div className="mt-1 text-xs text-muted-soft">{sublabel}</div>}
    </div>
  );
}

// Small hover/focus-reveal info tooltip — CSS-only (no state, no new dependency), keyboard
// reachable via a real <button> so it's not mouse-only. Used to explain a metric's definition
// (and formula, where relevant) right where the metric is shown, instead of a separate help page.
export function InfoTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label={label} className="leading-none text-muted-soft outline-none hover:text-foreground focus:text-foreground">
        ⓘ
      </button>
      <span
        role="tooltip"
        className="shadow-panel pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-60 -translate-x-1/2 rounded-md border border-border bg-surface-raised p-2.5 text-[11px] font-normal normal-case leading-snug text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {body && <div className="max-w-sm text-xs text-muted">{body}</div>}
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted ${className}`}>{children}</th>;
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 text-sm text-foreground ${className}`}>{children}</td>;
}

export function LinkPill({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-accent hover:underline underline-offset-2">
      {children}
    </Link>
  );
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${tone === "accent" ? "border-accent/30 bg-accent-soft text-accent" : "border-border text-muted"}`}>
      {children}
    </span>
  );
}

// Overstock is a separate, independent flag from HEALTHY/LOW/CRITICAL status (a material can be
// both HEALTHY and overstocked) — a small standalone badge, not part of StatusBadge's StockStatus
// union. Reuses the --status-excess tokens already defined for the IN_TRANSIT request badge.
export function OverstockBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--status-excess-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-excess)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-excess)]" />
      Overstock
    </span>
  );
}

// Shared icon-only Edit/Delete actions for master-data tables (Materials, Locations) — outline
// style matching theme-toggle.tsx/notification-bell.tsx, no new icon library.
export function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
