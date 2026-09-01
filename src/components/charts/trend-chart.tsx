"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function TrendChart({
  data,
  dataKey,
  color = "#3aa0ff",
  unit = "",
  referenceLines = [],
  height = 220,
}: {
  data: { date: string; [key: string]: string | number }[];
  dataKey: string;
  color?: string;
  unit?: string;
  referenceLines?: { value: number; label: string; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1a212e" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#5c6779" }}
          tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}
          axisLine={{ stroke: "#232b3a" }}
          tickLine={false}
          minTickGap={30}
        />
        <YAxis tick={{ fontSize: 10, fill: "#5c6779" }} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          contentStyle={{ background: "#161d29", border: "1px solid #232b3a", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(v) => (v ? new Date(String(v)).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }) : "")}
          formatter={(value) => [`${Number(value).toLocaleString()} ${unit}`, ""]}
        />
        {referenceLines.map((r, i) => (
          <ReferenceLine key={i} y={r.value} stroke={r.color} strokeDasharray="4 4" label={{ value: r.label, position: "insideTopRight", fontSize: 10, fill: r.color }} />
        ))}
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#fill-${dataKey})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
