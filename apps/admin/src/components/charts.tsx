import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";

export type Series = { key: string; label: string; color: string };

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};

function dayTick(value: string) {
  try {
    return format(parseISO(value), "MMM d");
  } catch {
    return value;
  }
}

export function DailyAreaChart<T extends { day: string }>({
  data,
  series,
  height = 220,
}: {
  data: T[];
  series: Series[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayTick}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => dayTick(String(v))} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#fill-${s.key})`}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DailyStackedBarChart<T extends { day: string }>({
  data,
  series,
  height = 220,
}: {
  data: T[];
  series: Series[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayTick}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "var(--accent)" }}
          labelFormatter={(v) => dayTick(String(v))}
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId="a"
            fill={s.color}
            radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bar list (funnels, breakdowns) without a chart library. */
export function BarList({
  items,
  max,
  format: fmt = (n) => n.toLocaleString(),
}: {
  items: { label: string; value: number; hint?: string }[];
  max?: number;
  format?: (n: number) => string;
}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-2">
            <span className="truncate">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {fmt(item.value)}
              {item.hint && <span className="ml-2 text-xs">{item.hint}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(2, (item.value / top) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
