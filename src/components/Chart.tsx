"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { formatChartDate } from "@/lib/dateFormat";

export default function Chart({ history, players, startingCapital }: {
  history: Record<string, number | string>[];
  players: { id: number; name: string; color: string }[];
  startingCapital: number;
}) {
  if (history.length === 0) return null;
  return (
    <div style={{ width: "100%", height: 360 }}>
      <ResponsiveContainer>
        <LineChart data={history}>
          <XAxis dataKey="date" fontSize={12} tickFormatter={formatChartDate} />
          <YAxis domain={["auto", "auto"]} fontSize={12} width={70} />
          <Tooltip
            formatter={(v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            labelFormatter={formatChartDate}
          />
          <Legend />
          <ReferenceLine y={startingCapital} strokeDasharray="4 4" />
          {players.map((p) => (
            <Line key={p.id} type="monotone" dataKey={String(p.id)} name={p.name} stroke={p.color} dot={false} strokeWidth={2} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
