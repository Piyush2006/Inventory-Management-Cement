"use client";

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Series {
  dataKey: string;
  color: string;
  label: string;
  unit?: string;
  // Left is the default axis; a series can opt into its own right-hand axis when it's a very
  // different order of magnitude from the others (e.g. Stock in MT vs. Consumption in MT/day) —
  // sharing one linear axis would otherwise flatten the smaller series to an invisible line.
  axis?: "left" | "right";
}

export function TrendChart({
  data,
  series,
  height = 220,
}: {
  data: { date: string; [key: string]: string | number }[];
  series: Series[];
  height?: number;
}) {
  const hasRightAxis = series.some((s) => s.axis === "right");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: hasRightAxis ? 0 : 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.dataKey} id={`fill-${s.dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {/* CSS custom properties, not fixed hex — these were hardcoded to dark-theme values
            before, so the tooltip rendered dark-on-dark (unreadable) in light mode. */}
        <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--muted-soft)" }}
          tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-AU", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
          minTickGap={30}
        />
        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "var(--muted-soft)" }} axisLine={false} tickLine={false} width={48} />
        {hasRightAxis && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 10, fill: "var(--muted-soft)" }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
        )}
        <Tooltip
          contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }}
          labelStyle={{ color: "var(--foreground)" }}
          itemStyle={{ color: "var(--foreground)" }}
          labelFormatter={(v) => (v ? new Date(String(v)).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "")}
          formatter={(value, name) => {
            const s = series.find((x) => x.label === name);
            return [`${Number(value).toLocaleString()} ${s?.unit ?? ""}`, name];
          }}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted)" }} iconType="circle" iconSize={8} />}
        {series.map((s) => (
          <Area
            key={s.dataKey}
            yAxisId={s.axis === "right" ? "right" : "left"}
            type="monotone"
            dataKey={s.dataKey}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#fill-${s.dataKey})`}
            dot={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
