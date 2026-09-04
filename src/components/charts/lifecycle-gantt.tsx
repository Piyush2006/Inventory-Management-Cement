"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import { intervalToDuration } from "date-fns";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Panel, EmptyState, ChevronIcon } from "@/components/ui";

export type GanttEvent = {
  id: string;
  action: string;
  timestamp: string;
  userName: string;
  role: string;
  quantity: number | null;
  reason: string | null;
};

// A request/spare's lifecycle is a log, not a fixed sequence — NOT_RECEIVED and
// PARTIALLY_RECEIVED can loop back through re-assignment (see the RequestStatus lifecycle
// comment in enums.ts), so neither counts as terminal here even though they look like resting
// states. Only these two actions truly end the log.
const TERMINAL_ACTIONS = new Set(["REJECTED", "COMPLETED"]);

// One distinct hue per stage (--stage-* tokens in globals.css) — deliberately its own palette
// rather than RequestStatusBadge's --status-* tokens, which intentionally group several stages
// under one shared semantic tone (e.g. Assigned/Delivered/Partially Received all read
// "warning" there). Here the stage's identity is what needs to stand out, especially in the
// collapsed single-bar view where two adjacent same-colored segments would blend together.
const EVENT_COLOR: Record<string, string> = {
  REQUEST_CREATED: "var(--stage-created)",
  ACCEPTED: "var(--stage-accepted)",
  ROUTED: "var(--stage-routed)",
  ASSIGNED: "var(--stage-assigned)",
  IN_TRANSIT: "var(--stage-in-transit)",
  DELIVERED: "var(--stage-delivered)",
  RECEIVED: "var(--stage-received)",
  PARTIALLY_RECEIVED: "var(--stage-partial)",
  COMPLETED: "var(--stage-completed)",
  REJECTED: "var(--stage-rejected)",
  NOT_RECEIVED: "var(--stage-not-received)",
};

function formatShortDuration(ms: number): string {
  if (ms <= 0) return "Instant";
  const d = intervalToDuration({ start: 0, end: ms });
  const parts: string[] = [];
  if (d.days) parts.push(`${d.days}d`);
  if (d.hours) parts.push(`${d.hours}h`);
  if (!d.days && d.minutes) parts.push(`${d.minutes}m`);
  if (parts.length === 0) return "< 1m";
  return parts.slice(0, 2).join(" ");
}

type GanttRow = {
  key: string;
  category: string;
  action: string;
  offset: number; // ms relative to the chart's own start (domainStart), NOT an absolute epoch value
  visibleDuration: number;
  actualDurationMs: number;
  startMs: number;
  endMs: number;
  inProgress: boolean;
  userName: string;
  role: string;
  quantity: number | null;
  reason: string | null;
};

// Recharts stacks a row's Bars by SUMMING their values against the shared axis scale — so the
// invisible "offset" bar's value must be a delta from the chart's own start (0..span), not an
// absolute epoch-ms timestamp. Using absolute timestamps here (as an earlier version of this
// component did) makes the offset value dwarf the axis domain, so every visible bar renders
// off-scale and effectively disappears. The XAxis domain is set to [0, totalSpanMs] to match,
// and its tickFormatter adds domainStart back on to show real dates.
function buildRows(events: GanttEvent[], labels: Record<string, string>, nowIso: string): { rows: GanttRow[]; domainStart: number; domainEnd: number } {
  if (events.length === 0) return { rows: [], domainStart: 0, domainEnd: 0 };
  const nowMs = new Date(nowIso).getTime();
  const domainStart = new Date(events[0].timestamp).getTime();
  const lastIsOpen = !TERMINAL_ACTIONS.has(events[events.length - 1].action);
  const domainEnd = lastIsOpen ? nowMs : new Date(events[events.length - 1].timestamp).getTime();
  const minVisibleMs = Math.max((domainEnd - domainStart) * 0.01, 60_000);

  const seen: Record<string, number> = {};
  const rows = events.map((e, i) => {
    seen[e.action] = (seen[e.action] ?? 0) + 1;
    const n = seen[e.action];
    const base = labels[e.action] ?? e.action;
    const category = n > 1 ? `${base} (${n})` : base;

    const startMs = new Date(e.timestamp).getTime();
    const next = events[i + 1];
    const isTerminal = TERMINAL_ACTIONS.has(e.action);

    let endMs: number;
    let inProgress = false;
    if (next) {
      endMs = new Date(next.timestamp).getTime();
    } else if (isTerminal) {
      endMs = startMs;
    } else {
      endMs = nowMs;
      inProgress = true;
    }

    const actualDurationMs = Math.max(endMs - startMs, 0);
    return {
      key: e.id,
      category,
      action: e.action,
      offset: startMs - domainStart,
      visibleDuration: Math.max(actualDurationMs, minVisibleMs),
      actualDurationMs,
      startMs,
      endMs,
      inProgress,
      userName: e.userName,
      role: e.role,
      quantity: e.quantity,
      reason: e.reason,
    };
  });
  return { rows, domainStart, domainEnd };
}

// Shared tooltip body — used by both the full multi-row Gantt and the collapsed single-bar
// summary, so hovering a stage shows identically detailed info in either view.
function GanttTooltipBody({ row, uom }: { row: GanttRow; uom: string }) {
  return (
    <div
      className="rounded-md border px-2.5 py-2 text-xs shadow-panel"
      style={{ background: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--foreground)" }}
    >
      <div className="font-medium">{row.category}</div>
      <div className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
        {formatDateTime(new Date(row.startMs))} → {row.inProgress ? "In progress" : formatDateTime(new Date(row.endMs))}
      </div>
      <div className="mt-0.5 text-[11px]" style={{ color: "var(--muted-soft)" }}>
        {row.inProgress ? "Ongoing — " : ""}
        {formatShortDuration(row.actualDurationMs)}
      </div>
      <div className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
        {row.userName} ({row.role})
        {row.quantity != null ? ` — ${formatNumber(row.quantity)} ${uom}` : ""}
      </div>
      {row.reason && (
        <div className="mt-0.5 text-[11px]" style={{ color: "var(--muted-soft)" }}>
          {row.reason}
        </div>
      )}
    </div>
  );
}

function GanttTooltip({ active, payload, uom }: TooltipContentProps & { uom: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as GanttRow | undefined;
  if (!row) return null;
  return <GanttTooltipBody row={row} uom={uom} />;
}

// The collapsed view's single bar has one Recharts <Bar> per stage, all stacked into the same
// row — so a hovered segment's payload only ever carries that one series' dataKey/value, not
// the whole row object. `shared={false}` on the Tooltip is what limits the payload to just the
// segment under the cursor instead of every stacked series at that position.
function GanttSegmentTooltip({ active, payload, rows, uom }: TooltipContentProps & { rows: GanttRow[]; uom: string }) {
  if (!active || !payload?.length) return null;
  const dataKey = payload[0]?.dataKey as string | undefined;
  const row = rows.find((r) => r.key === dataKey);
  if (!row) return null;
  return <GanttTooltipBody row={row} uom={uom} />;
}

function LifecycleGanttExpanded({ rows, domainStart, domainEnd, uom }: { rows: GanttRow[]; domainStart: number; domainEnd: number; uom: string }) {
  const totalSpan = Math.max(domainEnd - domainStart, 60_000);
  const height = Math.max(rows.length * 32 + 40, 96);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }} barCategoryGap={rows.length > 1 ? "24%" : "40%"}>
        <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, totalSpan]}
          tickFormatter={(v: number) => formatDateTime(new Date(domainStart + v))}
          tick={{ fontSize: 10, fontFamily: "var(--font-sans)", fill: "var(--muted-soft)" }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          type="category"
          dataKey="category"
          width={150}
          tick={{ fontSize: 11, fontFamily: "var(--font-sans)", fill: "var(--foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={(props) => <GanttTooltip {...props} uom={uom} />} cursor={{ fill: "var(--surface-raised)" }} />
        <Bar dataKey="offset" stackId="gantt" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="visibleDuration" stackId="gantt" radius={3} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell
              key={row.key}
              fill={EVENT_COLOR[row.action] ?? "var(--status-unknown)"}
              fillOpacity={row.inProgress ? 0.45 : 0.9}
              stroke={row.inProgress ? (EVENT_COLOR[row.action] ?? "var(--status-unknown)") : "none"}
              strokeDasharray={row.inProgress ? "4 3" : undefined}
              strokeWidth={row.inProgress ? 1.5 : 0}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Collapsed view — the whole lifecycle as one bar, split into a colored segment per stage
// (same colors, same proportional-with-a-floor widths as the expanded rows). Recharts has no
// "single stacked bar" chart type, so this reuses the same BarChart-with-stacked-Bars trick as
// the expanded view, just with only one category ("Lifecycle") and one <Bar> per stage instead
// of one <Bar> per row — each stage's Bar stacks directly after the previous one, contiguous,
// no invisible offset bar needed since there's nothing to skip past on a single row.
function LifecycleGanttCollapsed({ rows, uom }: { rows: GanttRow[]; uom: string }) {
  const data = [Object.fromEntries([["category", "Lifecycle"], ...rows.map((r) => [r.key, r.visibleDuration])])];
  // Recharts pads a numeric axis to a "nice" rounded max by default unless given an explicit
  // domain — left as `["auto", "auto"]` here, that padding showed up as dead space after the
  // last segment instead of the bar filling its container. Setting the domain to exactly the
  // stacked total closes that gap.
  const total = rows.reduce((sum, r) => sum + r.visibleDuration, 0);

  return (
    <div>
      <div className="overflow-hidden rounded-md border border-border-soft">
        <ResponsiveContainer width="100%" height={40}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis type="number" domain={[0, total]} hide />
            <YAxis type="category" dataKey="category" hide />
            <Tooltip shared={false} content={(props) => <GanttSegmentTooltip {...props} rows={rows} uom={uom} />} cursor={{ fill: "var(--surface-raised)" }} />
            {rows.map((row) => (
              <Bar
                key={row.key}
                dataKey={row.key}
                stackId="single"
                isAnimationActive={false}
                fill={EVENT_COLOR[row.action] ?? "var(--status-unknown)"}
                fillOpacity={row.inProgress ? 0.45 : 0.9}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* A single bar has no room for per-segment labels — this identifies each color without
          requiring a hover, same de-duplicated names as the expanded view's Y axis. */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {rows.map((row) => (
          <span key={row.key} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: EVENT_COLOR[row.action] ?? "var(--status-unknown)", opacity: row.inProgress ? 0.45 : 0.9 }}
            />
            {row.category}
          </span>
        ))}
      </div>
    </div>
  );
}

// Owns the Panel wrapper + collapse/expand toggle itself (rather than page.tsx doing it) so the
// toggle state and the chart it controls stay in one client component — Panel is a plain
// presentational component with no server-only APIs, so it's fine to render from here too.
export function LifecycleGanttPanel({ events, labels, now, uom }: { events: GanttEvent[]; labels: Record<string, string>; now: string; uom: string }) {
  const [expanded, setExpanded] = useState(true);
  const { rows, domainStart, domainEnd } = buildRows(events, labels, now);

  return (
    <Panel
      title="Lifecycle Gantt"
      action={
        rows.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
          >
            {expanded ? "Collapse" : "Expand"}
            <ChevronIcon open={expanded} />
          </button>
        )
      }
    >
      {rows.length === 0 ? (
        <EmptyState title="No events yet" />
      ) : expanded ? (
        <LifecycleGanttExpanded rows={rows} domainStart={domainStart} domainEnd={domainEnd} uom={uom} />
      ) : (
        <LifecycleGanttCollapsed rows={rows} uom={uom} />
      )}
    </Panel>
  );
}
