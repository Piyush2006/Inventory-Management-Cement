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

export function KpiTile({ label, value, sublabel, tone = "default" }: { label: string; value: ReactNode; sublabel?: ReactNode; tone?: "default" | "critical" | "warning" | "healthy" }) {
  const toneClass =
    tone === "critical" ? "text-[var(--status-critical)]" : tone === "warning" ? "text-[var(--status-warning)]" : tone === "healthy" ? "text-[var(--status-healthy)]" : "text-foreground";
  return (
    <div className="shadow-panel rounded-lg border border-border bg-surface px-4 py-3.5 transition-colors">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular ${toneClass}`}>{value}</div>
      {sublabel && <div className="mt-1 text-xs text-muted-soft">{sublabel}</div>}
    </div>
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
