"use client";

import { useState } from "react";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartDate } from "@/lib/dateFormat";
import ChartTooltipCard from "@/components/ChartTooltipCard";

const palette = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16", "#f97316"];

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const gradientId = (key: string) => `profile-fill-${key.replace(/[^a-zA-Z0-9]/g, "-")}`;

type Series = { key: string; color: string };

function PicksTooltip({
  active,
  payload,
  label,
  series,
  activeKey,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | string }[];
  label?: string;
  series: Series[];
  activeKey: string | null;
}) {
  if (!active || !payload?.length) return null;
  // The hit-area lines and gradient area duplicate series in the payload.
  const uniqueByKey = [...new Map(payload.map((entry) => [entry.dataKey, entry])).values()];
  const rows = uniqueByKey
    .filter((entry) => typeof entry.value === "number")
    .sort((a, b) => Number(b.value) - Number(a.value))
    .flatMap((entry) => {
      const s = series.find((candidate) => candidate.key === entry.dataKey);
      if (!s) return [];
      return [{
        key: s.key,
        color: s.color,
        name: s.key,
        value: fmtPct(Number(entry.value)),
        emphasized: s.key === activeKey,
      }];
    });
  return <ChartTooltipCard label={formatChartDate(label)} rows={rows} />;
}

export default function ProfileChart({
  history,
  symbols,
  playerColor,
}: {
  history: Record<string, number | string>[];
  symbols: string[];
  playerColor: string;
}) {
  const [selected, setSelected] = useState<string | null>("Total");
  const [hovered, setHovered] = useState<string | null>(null);
  if (history.length === 0) return <p className="p-4 text-sm text-gray-500">History starts with the first daily snapshot.</p>;

  const series: Series[] = [
    { key: "Total", color: playerColor },
    ...symbols.map((symbol, index) => ({ key: symbol, color: palette[index % palette.length] })),
  ];
  const activeKey = hovered ?? selected;
  const activeSeries = series.find((s) => s.key === activeKey) ?? null;

  return (
    <section className="border-t border-gray-200 p-3 dark:border-gray-800">
      <div className="mb-2">
        <h3 className="font-bold">Pick performance</h3>
        <p className="text-xs text-gray-500">Every line is percentage return from the race start. MVP returns include the 2× score.</p>
      </div>
      <div className="h-80 w-full" onMouseLeave={() => setHovered(null)}>
        <ResponsiveContainer>
          <ComposedChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={`grad-${s.key}`} id={gradientId(s.key)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              tickMargin={8}
              minTickGap={48}
              tickFormatter={formatChartDate}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              width={52}
              domain={["auto", "auto"]}
              tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
            />
            <Tooltip
              content={<PicksTooltip series={series} activeKey={activeKey} />}
              cursor={{ stroke: "#9ca3af", strokeOpacity: 0.4, strokeDasharray: "3 3" }}
            />
            <ReferenceLine y={0} stroke="#9ca3af" strokeOpacity={0.35} strokeDasharray="4 4" />
            {activeSeries && (
              <Area
                type="monotone"
                dataKey={activeSeries.key}
                stroke="none"
                fill={`url(#${gradientId(activeSeries.key)})`}
                connectNulls
                isAnimationActive={false}
                activeDot={false}
                tooltipType="none"
              />
            )}
            {series.map((s) => {
              const isActive = s.key === activeKey;
              const dimmed = activeKey !== null && !isActive;
              return (
                <Line
                  key={`line-${s.key}`}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={isActive ? 3 : 1.75}
                  strokeOpacity={dimmed ? 0.2 : 1}
                  dot={false}
                  activeDot={isActive ? { r: 4, strokeWidth: 0 } : false}
                  connectNulls
                  isAnimationActive={false}
                />
              );
            })}
            {/* Transparent wide strokes on top give the thin lines a hoverable hit area. */}
            {series.map((s) => (
              <Line
                key={`hit-${s.key}`}
                type="monotone"
                dataKey={s.key}
                stroke="transparent"
                strokeWidth={14}
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
                tooltipType="none"
                onMouseEnter={() => setHovered(s.key)}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {series.map((s) => {
          const isActive = s.key === activeKey;
          return (
            <button
              key={`chip-${s.key}`}
              type="button"
              aria-pressed={isActive}
              onClick={() => setSelected((current) => current === s.key ? null : s.key)}
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(s.key)}
              onBlur={() => setHovered(null)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs font-semibold transition ${
                isActive
                  ? "border-transparent text-gray-900 dark:text-white"
                  : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
              }`}
              style={isActive ? { background: `${s.color}33` } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.key}
            </button>
          );
        })}
      </div>
    </section>
  );
}
