const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function dateOnlyParts(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

export function formatEuropeanDate(value: string | number | Date): string {
  if (typeof value === "string") {
    const dateOnly = dateOnlyParts(value);
    if (dateOnly) return dateOnly;
  }
  return dateFormatter.format(new Date(value));
}

export function formatEuropeanDateTime(value: string | number | Date): string {
  return dateTimeFormatter.format(new Date(value));
}

export function formatEuropeanTime(value: string | number | Date): string {
  return timeFormatter.format(new Date(value));
}

const intradayTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const intradayDayTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatIntradayLabel(value: unknown, range: "1d" | "1w"): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return range === "1d" ? intradayTimeFormatter.format(date) : intradayDayTimeFormatter.format(date);
}

export function formatChartDate(value: unknown): string {
  if (value === "Live") return "Live";
  if (typeof value !== "string") return String(value ?? "");
  return dateOnlyParts(value) ?? value;
}
