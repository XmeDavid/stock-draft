"use client";

import {
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatChartDate } from "@/lib/dateFormat";

const colors = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16", "#f97316"];

export default function ProfileChart({
  history,
  symbols,
  playerColor,
}: {
  history: Record<string, number | string>[];
  symbols: string[];
  playerColor: string;
}) {
  if (history.length === 0) return <p className="p-4 text-sm text-gray-500">History starts with the first daily snapshot.</p>;

  return (
    <section className="border-t border-gray-200 p-3 dark:border-gray-800">
      <div className="mb-2">
        <h3 className="font-bold">Pick performance</h3>
        <p className="text-xs text-gray-500">Every line is percentage return from the race start. MVP returns include the 2× score.</p>
      </div>
      <div className="h-80 w-full">
        <ResponsiveContainer>
          <LineChart data={history} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <XAxis dataKey="date" fontSize={11} tickFormatter={formatChartDate} />
            <YAxis
              width={58}
              fontSize={11}
              tickFormatter={(value) => `${Number(value).toFixed(2)}%`}
              domain={["auto", "auto"]}
            />
            <Tooltip
              formatter={(value) => `${Number(value).toFixed(2)}%`}
              labelFormatter={formatChartDate}
            />
            <Legend />
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="Total" stroke={playerColor} strokeWidth={4} dot={false} connectNulls />
            {symbols.map((symbol, index) => (
              <Line
                key={symbol}
                type="monotone"
                dataKey={symbol}
                stroke={colors[index % colors.length]}
                strokeWidth={1.75}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
