"use client";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartDate, formatIntradayLabel } from "@/lib/dateFormat";
import ChartTooltipCard from "@/components/ChartTooltipCard";

type ChartPlayer = { id: number; name: string; color: string };
export type ChartTimeRange = "1d" | "1w" | null;

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });
const fmtValue = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });

function StandingsTooltip({
  active,
  payload,
  label,
  players,
  highlightId,
  formatLabel,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | string }[];
  label?: string;
  players: ChartPlayer[];
  highlightId: number | null;
  formatLabel: (value: unknown) => string;
}) {
  if (!active || !payload?.length) return null;
  // The hit-area lines and gradient area duplicate series in the payload.
  const uniqueByKey = [...new Map(payload.map((entry) => [entry.dataKey, entry])).values()];
  const rows = uniqueByKey
    .filter((entry) => typeof entry.value === "number")
    .sort((a, b) => Number(b.value) - Number(a.value))
    .flatMap((entry) => {
      const player = players.find((p) => String(p.id) === String(entry.dataKey));
      if (!player) return [];
      return [{
        key: String(player.id),
        color: player.color,
        name: player.name,
        value: fmtValue(Number(entry.value)),
        emphasized: player.id === highlightId,
      }];
    });
  return <ChartTooltipCard label={formatLabel(label)} rows={rows} />;
}

export default function Chart({ history, players, startingCapital, highlightId = null, onHighlight, timeRange = null }: {
  history: Record<string, number | string>[];
  players: ChartPlayer[];
  startingCapital: number;
  highlightId?: number | null;
  onHighlight?: (id: number | null) => void;
  timeRange?: ChartTimeRange;
}) {
  if (history.length === 0) return null;
  const formatLabel = timeRange
    ? (value: unknown) => formatIntradayLabel(value, timeRange)
    : formatChartDate;
  return (
    <div>
      <div className="h-[360px] w-full" onMouseLeave={() => onHighlight?.(null)}>
        <ResponsiveContainer>
          <ComposedChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {players.map((p) => (
                <linearGradient key={`grad-${p.id}`} id={`chart-fill-${p.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={p.color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={p.color} stopOpacity={0} />
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
              tickFormatter={formatLabel}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              width={44}
              domain={["auto", "auto"]}
              tickFormatter={(value) => compact.format(Number(value))}
            />
            <Tooltip
              content={<StandingsTooltip players={players} highlightId={highlightId} formatLabel={formatLabel} />}
              cursor={{ stroke: "#9ca3af", strokeOpacity: 0.4, strokeDasharray: "3 3" }}
            />
            <ReferenceLine y={startingCapital} stroke="#9ca3af" strokeOpacity={0.35} strokeDasharray="4 4" />
            {highlightId !== null && (
              <Area
                type="monotone"
                dataKey={String(highlightId)}
                stroke="none"
                fill={`url(#chart-fill-${highlightId})`}
                connectNulls
                isAnimationActive={false}
                activeDot={false}
                tooltipType="none"
              />
            )}
            {players.map((p) => {
              const dimmed = highlightId !== null && highlightId !== p.id;
              return (
                <Line
                  key={`line-${p.id}`}
                  type="monotone"
                  dataKey={String(p.id)}
                  name={p.name}
                  stroke={p.color}
                  strokeWidth={highlightId === p.id ? 3 : 2}
                  strokeOpacity={dimmed ? 0.2 : 1}
                  dot={false}
                  activeDot={highlightId === p.id ? { r: 4, strokeWidth: 0 } : false}
                  connectNulls
                  isAnimationActive={false}
                />
              );
            })}
            {/* Transparent wide strokes on top give the thin lines a hoverable hit area. */}
            {players.map((p) => (
              <Line
                key={`hit-${p.id}`}
                type="monotone"
                dataKey={String(p.id)}
                stroke="transparent"
                strokeWidth={14}
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
                tooltipType="none"
                onMouseEnter={() => onHighlight?.(p.id)}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {players.map((p) => {
          const active = highlightId === p.id;
          return (
            <button
              key={`chip-${p.id}`}
              type="button"
              onMouseEnter={() => onHighlight?.(p.id)}
              onMouseLeave={() => onHighlight?.(null)}
              onFocus={() => onHighlight?.(p.id)}
              onBlur={() => onHighlight?.(null)}
              className={`flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                active
                  ? "border-transparent text-gray-900 dark:text-white"
                  : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
              }`}
              style={active ? { background: `${p.color}33` } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
