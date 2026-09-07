"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Area, ComposedChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber } from "@/lib/format";

interface FlowDay {
  date: string;
  opening: number;
  received: number;
  consumed: number;
  dispatched: number;
  transferredOut: number;
  adjusted: number;
  closing: number;
}

interface MaterialOption {
  id: string;
  name: string;
  uom: string;
}

const COLOR = {
  received: "var(--status-healthy)",
  consumed: "var(--status-critical)",
  dispatched: "var(--status-warning)",
  transferred: "var(--status-exception)",
  adjusted: "var(--status-exception)",
  level: "var(--status-transit)",
  area: "var(--status-transit-bg)",
};

function LineLegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      <svg viewBox="0 0 20 8" width="18" height="8" className="shrink-0">
        <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

function AreaLegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// Hover tooltip for the chart — regardless of which specific colored segment is under the
// cursor, it always shows the FULL day breakdown (Opening/Received/Consumed/Dispatched/Closing,
// always rendered even at zero, matching the day-card convention this replaces) by looking the
// hovered x-position up in idxToDay rather than reading Recharts' own per-series payload. A
// stable top-level component (idxToDay passed in as a prop, via `content={<FlowTooltipContent
// idxToDay={...} />}`) rather than one manufactured per-render through useMemo, which resets
// component identity on every render.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlowTooltipContent({ active, label, idxToDay }: any) {
  if (!active || label == null) return null;
  const day = (idxToDay as Map<number, FlowDay>).get(label as number);
  if (!day) return null;
  const rows: { label: string; value: number; color: string; signed?: boolean }[] = [
    { label: "Opening", value: day.opening, color: COLOR.level },
    { label: "Received", value: day.received, color: COLOR.received, signed: true },
    { label: "Consumed", value: day.consumed === 0 ? 0 : -day.consumed, color: COLOR.consumed, signed: true },
    { label: "Dispatched", value: day.dispatched === 0 ? 0 : -day.dispatched, color: COLOR.dispatched, signed: true },
    ...(day.transferredOut > 1e-6 ? [{ label: "Transferred", value: -day.transferredOut, color: COLOR.transferred, signed: true }] : []),
    ...(Math.abs(day.adjusted) > 1e-6 ? [{ label: "Adjusted", value: day.adjusted, color: COLOR.adjusted, signed: true }] : []),
    { label: "Closing", value: day.closing, color: COLOR.level },
  ];
  return (
    <div className="rounded-md border border-border bg-surface-raised px-2.5 py-2 shadow-lg">
      <div className="mb-1 text-[11px] font-semibold text-foreground">{formatDayLabel(day.date)}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3 whitespace-nowrap text-[11px]" style={{ color: r.color }}>
          <span>{r.label}</span>
          <span className="font-semibold tabular">{r.signed && r.value > 0 ? "+" : ""}{formatNumber(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

// The blue boundary marker (day-opening/closing points) — a value box drawn via the `dot`
// render-prop rather than Recharts' `label` prop, which was proven unreliable for sparse
// multi-segment Lines during earlier iterations on this chart (only 2/14 expected labels
// rendered); `dot` fires reliably for every defined point.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BoundaryDot(props: any) {
  const { cx, cy, value, payload } = props as { cx?: number; cy?: number; value?: number | null; payload?: { boundaryTags?: string[] } };
  if (cx == null || cy == null || value == null) return null;
  const tags = payload?.boundaryTags ?? [];
  const text = formatNumber(value);
  const boxWidth = Math.max(52, text.length * 6.5 + 12);
  const tagLineHeight = 9;
  const boxHeight = 16 + tags.length * tagLineHeight;
  const boxY = cy - boxHeight - 10;
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill={COLOR.level} stroke="var(--surface)" strokeWidth={2} />
      <rect x={cx - boxWidth / 2} y={boxY} width={boxWidth} height={boxHeight} rx={4} fill="var(--surface)" stroke="var(--border)" strokeWidth={1} />
      {tags.map((tag, i) => (
        <text key={tag} x={cx} y={boxY + 9 + i * tagLineHeight} textAnchor="middle" fontSize={8} fill="var(--muted-soft)">{tag}</text>
      ))}
      <text x={cx} y={boxY + boxHeight - 5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--foreground)">{text}</text>
    </g>
  );
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Kolkata" });
  return `${day} (${weekday})`;
}

type Category = "received" | "consumed" | "dispatched" | "transferred" | "adjusted";
interface ChartRow {
  idx: number;
  level: number;
  boundary?: number;
  boundaryTags?: string[];
  received?: number;
  consumed?: number;
  dispatched?: number;
  transferred?: number;
  adjusted?: number;
  flat?: number;
}

export function MaterialFlowChart({
  materials,
  defaultMaterialId,
  seriesByMaterial,
  range,
}: {
  materials: MaterialOption[];
  defaultMaterialId: string | null;
  seriesByMaterial: Record<string, FlowDay[]>;
  range: { start: string; end: string; maxDate: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [materialId, setMaterialId] = useState(defaultMaterialId ?? materials[0]?.id ?? "");
  const material = materials.find((m) => m.id === materialId);
  const series = useMemo(() => seriesByMaterial[materialId] ?? [], [seriesByMaterial, materialId]);

  function handleRangeChange(field: "from" | "to", value: string) {
    if (!value) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set(field, value);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  // Flattens the day-by-day series into one continuous walk: opening -> (a point per non-zero
  // movement category, in a fixed order) -> closing, where each day's closing point IS the next
  // day's opening point (same idx), so the whole 14-day window renders as a single unbroken path.
  // Each category gets its own sparse Line (real only at the 2 endpoints of each occurrence,
  // connectNulls=false) so every segment gets its own color; the dense "level" field backs the
  // Area fill and never has a gap.
  const { chartData, dayRanges, maxIdx } = useMemo(() => {
    if (series.length === 0) return { chartData: [] as ChartRow[], dayRanges: [] as { date: string; startIdx: number; endIdx: number }[], maxIdx: 0 };
    const rows: ChartRow[] = [];
    let idx = 0;
    let value = series[0].opening;
    rows.push({ idx, level: value, boundary: value, boundaryTags: ["Opening"] });
    const dayRanges: { date: string; startIdx: number; endIdx: number }[] = [];

    series.forEach((day, dayIdx) => {
      const startIdx = idx;
      const stages: [Category, number][] = [
        ...(day.received > 1e-6 ? [["received", day.received] as [Category, number]] : []),
        ...(day.consumed > 1e-6 ? [["consumed", -day.consumed] as [Category, number]] : []),
        ...(day.dispatched > 1e-6 ? [["dispatched", -day.dispatched] as [Category, number]] : []),
        ...(day.transferredOut > 1e-6 ? [["transferred", -day.transferredOut] as [Category, number]] : []),
        ...(Math.abs(day.adjusted) > 1e-6 ? [["adjusted", day.adjusted] as [Category, number]] : []),
      ];

      // A day with zero movement has no stage points at all — without a connector, that day
      // would render as a blank gap in the path (no colored Line spans it). Give it a flat,
      // neutral-colored segment instead so the path is unbroken across every day.
      if (stages.length === 0) (rows[startIdx] as ChartRow).flat = value;

      stages.forEach(([cat, delta]) => {
        const fromIdx = idx;
        const fromValue = value;
        idx += 1;
        value += delta;
        rows.push({ idx, level: value, [cat]: value } as ChartRow);
        (rows[fromIdx] as ChartRow)[cat] = fromValue;
      });

      idx += 1;
      const isLast = dayIdx === series.length - 1;
      const boundaryRow: ChartRow = { idx, level: value, boundary: value, boundaryTags: isLast ? ["Closing"] : ["Closing", "Opening"] };
      if (stages.length === 0) {
        boundaryRow.flat = value;
      } else {
        // The last stage's own endpoint sits one idx short of the boundary marker — without
        // also stamping that same category here, its colored Line stops one unit before the
        // boundary dot, leaving a visible gap right where the dot sits.
        const lastCategory = stages[stages.length - 1][0];
        boundaryRow[lastCategory] = value;
      }
      rows.push(boundaryRow);
      dayRanges.push({ date: day.date, startIdx, endIdx: idx });
    });

    return { chartData: rows, dayRanges, maxIdx: idx };
  }, [series]);

  const dayTicks = useMemo(
    () => dayRanges.map((r) => ({ idx: Math.round((r.startIdx + r.endIdx) / 2), date: r.date })),
    [dayRanges]
  );
  const boundaryRefLines = useMemo(() => dayRanges.slice(0, -1).map((r) => r.endIdx), [dayRanges]);

  // Every idx within a day's [startIdx, endIdx] range maps to that day, so hovering ANY point of
  // the day's path (not just its boundary) surfaces that day's full breakdown in the tooltip.
  const idxToDay = useMemo(() => {
    const map = new Map<number, FlowDay>();
    dayRanges.forEach((r, i) => {
      for (let idx = r.startIdx; idx <= r.endIdx; idx++) map.set(idx, series[i]);
    });
    return map;
  }, [dayRanges, series]);

  const yDomain = useMemo((): [number, number] => {
    if (chartData.length === 0) return [0, 100];
    const values = chartData.map((r) => r.level);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(1, (max - min) * 0.15);
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
  }, [chartData]);

  const pxPerIdx = 90;
  const chartMinWidth = Math.max(700, maxIdx * pxPerIdx);

  if (!material || series.length === 0) {
    return <div className="p-4 text-sm text-muted-soft">No material movement data available.</div>;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-soft">Opening stock, receipts (inward), consumption, dispatches and closing stock — continuous daily flow.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={range.start}
            max={range.end}
            onChange={(e) => handleRangeChange("from", e.target.value)}
            className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent"
            aria-label="From date"
          />
          <span className="text-xs text-muted-soft">–</span>
          <input
            type="date"
            value={range.end}
            min={range.start}
            max={range.maxDate}
            onChange={(e) => handleRangeChange("to", e.target.value)}
            className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent"
            aria-label="To date"
          />
          <select
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          >
            {materials.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        <LineLegendItem color={COLOR.received} label="Receipts (Inward)" />
        <LineLegendItem color={COLOR.consumed} label="Consumption" />
        <LineLegendItem color={COLOR.dispatched} label="Dispatches" />
        <LineLegendItem color={COLOR.level} label="Inventory Level" />
        <AreaLegendItem color={COLOR.area} label="Area = Inventory Level" />
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <div style={{ minWidth: `${chartMinWidth}px` }}>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 40, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="idx"
                type="number"
                domain={[0, maxIdx]}
                ticks={dayTicks.map((t) => t.idx)}
                tickFormatter={(v: number) => dayTicks.find((t) => t.idx === v)?.date ? formatDayLabel(dayTicks.find((t) => t.idx === v)!.date) : ""}
                tick={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: 10, fill: "var(--muted-soft)" }}
                axisLine={false}
                tickLine={false}
                width={52}
                tickFormatter={(v: number) => formatNumber(v)}
              />
              {boundaryRefLines.map((idx) => (
                <ReferenceLine key={idx} x={idx} stroke="var(--muted-soft)" strokeWidth={1.5} strokeDasharray="5 4" ifOverflow="extendDomain" />
              ))}
              <Tooltip content={<FlowTooltipContent idxToDay={idxToDay} />} cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }} />
              <Area dataKey="level" type="stepAfter" stroke="none" fill={COLOR.area} fillOpacity={1} isAnimationActive={false} />
              <Line dataKey="received" type="stepAfter" stroke={COLOR.received} strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="consumed" type="stepAfter" stroke={COLOR.consumed} strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="dispatched" type="stepAfter" stroke={COLOR.dispatched} strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="transferred" type="stepAfter" stroke={COLOR.transferred} strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="adjusted" type="stepAfter" stroke={COLOR.adjusted} strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="flat" type="stepAfter" stroke={COLOR.level} strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="boundary" type="stepAfter" stroke="none" dot={BoundaryDot} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
