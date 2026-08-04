"use client";

export type TooltipRow = {
  key: string;
  color: string;
  name: string;
  value: string;
  emphasized?: boolean;
};

export default function ChartTooltipCard({ label, rows }: { label: string; rows: TooltipRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="min-w-44 rounded-xl border border-white/10 bg-gray-900/95 px-3 py-2.5 text-white shadow-xl backdrop-blur">
      <p className="mb-1.5 text-xs font-semibold text-gray-400">{label}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li
            key={row.key}
            className={`flex items-center justify-between gap-4 text-xs ${row.emphasized ? "font-bold" : ""}`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
              <span className={`truncate ${row.emphasized ? "text-white" : "text-gray-300"}`}>{row.name}</span>
            </span>
            <span className="font-mono">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
