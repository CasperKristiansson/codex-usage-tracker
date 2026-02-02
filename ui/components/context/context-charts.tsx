"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { LegendInline } from "@/components/charts/legend-inline";
import { formatBucketLabel, safeNumber, uniqueBuckets } from "@/lib/charts";
import { formatCompactNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ContextHistogram = {
  rows: Array<{ bin: number; count: number }>;
};

export type DangerRateTimeseries = {
  bucket: "hour" | "day";
  rows: Array<{ bucket: string; danger_rate: number | null; total?: number }>;
};

export type CompactionTimeseries = {
  bucket: "hour" | "day";
  rows: Array<{ bucket: string; event_type: string; count: number }>;
};

export type ContextTokensHeatmapData = {
  token_bin_size: number;
  rows: Array<{ context_bin: number; token_bin: number; count: number }>;
};

const TOOLTIP_STYLE = {
  wrapperStyle: { outline: "none" }
} as const;

const EVENT_META: Array<{
  key: string;
  label: string;
  color: string;
}> = [
  { key: "context_compacted", label: "Compaction", color: "#22D3EE" },
  { key: "thread_rolled_back", label: "Rollback", color: "#FBBF24" },
  { key: "undo_completed", label: "Undo", color: "#A78BFA" },
  { key: "turn_aborted", label: "Abort", color: "#F87171" }
];

const formatRate = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
};

export const ContextHistogramChart = ({ data }: { data: ContextHistogram }) => {
  const chartData = useMemo(
    () =>
      data.rows.map((row) => ({
        bin: safeNumber(row.bin),
        label: (() => {
          const start = safeNumber(row.bin);
          const end = Math.min(start + 5, 100);
          return start === end ? `${start}%` : `${start}-${end}%`;
        })(),
        count: safeNumber(row.count)
      })),
    [data.rows]
  );

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={chartData} margin={{ left: 8, right: 16, top: 8 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.2)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(value) => formatCompactNumber(Number(value))}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            content={
              <ChartTooltip
                labelFormatter={(value) => value}
                valueFormatter={(value) => formatCompactNumber(value)}
              />
            }
          />
          <ReferenceLine
            x="10-15%"
            stroke="hsl(var(--destructive))"
            strokeDasharray="3 3"
            label={{
              value: "Danger",
              position: "top",
              fill: "hsl(var(--destructive))",
              fontSize: 10
            }}
          />
          <Bar
            dataKey="count"
            name="Events"
            fill="hsl(var(--primary))"
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export const DangerRateChart = ({ data }: { data: DangerRateTimeseries }) => {
  const chartData = useMemo(
    () =>
      data.rows.map((row) => ({
        bucket: row.bucket,
        danger_rate:
          row.danger_rate === null || row.danger_rate === undefined
            ? null
            : safeNumber(row.danger_rate)
      })),
    [data.rows]
  );

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ left: 8, right: 16, top: 8 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.2)" vertical={false} />
          <XAxis
            dataKey="bucket"
            tickFormatter={(value) => formatBucketLabel(String(value), data.bucket)}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(value) => formatPercent(Number(value) / 100)}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            content={
              <ChartTooltip
                labelFormatter={(value) =>
                  formatBucketLabel(String(value), data.bucket)
                }
                valueFormatter={(value) => formatPercent(value / 100)}
              />
            }
          />
          <ReferenceLine
            y={10}
            stroke="hsl(var(--destructive))"
            strokeDasharray="3 3"
          />
          <Line
            type="monotone"
            dataKey="danger_rate"
            name="Danger rate"
            stroke="#F87171"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export const CompactionEventsChart = ({
  data
}: {
  data: CompactionTimeseries;
}) => {
  const seriesKeys = EVENT_META.map((item) => item.label);

  const chartData = useMemo(() => {
    const buckets = uniqueBuckets(data.rows);
    const rows = buckets.map((bucket) => {
      const row: Record<string, number | string> = { bucket };
      seriesKeys.forEach((key) => {
        row[key] = 0;
      });
      return row;
    });

    const rowMap = new Map(rows.map((row) => [row.bucket as string, row]));

    data.rows.forEach((row) => {
      const bucket = row.bucket;
      const meta = EVENT_META.find((item) => item.key === row.event_type);
      if (!meta) return;
      const record = rowMap.get(bucket);
      if (!record) return;
      record[meta.label] = safeNumber(row.count);
    });

    return rows;
  }, [data.rows, seriesKeys]);

  const totals = useMemo(() => {
    const totalMap = new Map<string, number>();
    EVENT_META.forEach((item) => totalMap.set(item.label, 0));
    data.rows.forEach((row) => {
      const meta = EVENT_META.find((item) => item.key === row.event_type);
      if (!meta) return;
      totalMap.set(meta.label, (totalMap.get(meta.label) ?? 0) + safeNumber(row.count));
    });
    return totalMap;
  }, [data.rows]);

  const legendItems = EVENT_META.map((item) => ({
    label: item.label,
    color: item.color,
    value: formatCompactNumber(totals.get(item.label))
  }));

  return (
    <div className="space-y-4">
      <LegendInline items={legendItems} />
      <div className="h-60 w-full">
        <ResponsiveContainer>
          <AreaChart data={chartData} margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid stroke="hsl(var(--border) / 0.2)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(value) =>
                formatBucketLabel(String(value), data.bucket)
              }
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value) => formatCompactNumber(Number(value))}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              content={
                <ChartTooltip
                  labelFormatter={(value) =>
                    formatBucketLabel(String(value), data.bucket)
                  }
                />
              }
            />
            {EVENT_META.map((item) => (
              <Area
                key={item.key}
                type="monotone"
                dataKey={item.label}
                name={item.label}
                stackId="events"
                stroke={item.color}
                fill={item.color}
                fillOpacity={0.2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const CompactionRatesTable = ({
  data,
  totalTurns,
  isLoadingTurns
}: {
  data: CompactionTimeseries;
  totalTurns?: number | null;
  isLoadingTurns?: boolean;
}) => {
  const totals = useMemo(() => {
    const totalMap = new Map<string, number>();
    EVENT_META.forEach((item) => totalMap.set(item.key, 0));
    data.rows.forEach((row) => {
      if (!totalMap.has(row.event_type)) return;
      totalMap.set(row.event_type, (totalMap.get(row.event_type) ?? 0) + safeNumber(row.count));
    });
    return totalMap;
  }, [data.rows]);

  const totalEvents = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  const turns = totalTurns ?? null;

  return (
    <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
      <div className="mb-2 text-xs font-semibold text-foreground">Normalized rates</div>
      <div className="text-[11px] text-muted-foreground">
        Rate per 1k turns
      </div>
      <div className="mt-3 overflow-hidden rounded-md border border-border/20">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Event</th>
              <th className="px-3 py-2 text-right font-medium">Count</th>
              <th className="px-3 py-2 text-right font-medium">Rate / 1k</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {EVENT_META.map((item) => {
              const count = totals.get(item.key) ?? 0;
              const rate = turns ? (count / turns) * 1000 : null;
              return (
                <tr key={item.key}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 text-foreground">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: item.color }}
                      />
                      {item.label}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatCompactNumber(count)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {isLoadingTurns ? "…" : formatRate(rate)}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-muted/30">
              <td className="px-3 py-2 font-semibold text-foreground">Total</td>
              <td className="px-3 py-2 text-right font-mono font-semibold">
                {formatCompactNumber(totalEvents)}
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold">
                {isLoadingTurns
                  ? "…"
                  : formatRate(turns ? (totalEvents / turns) * 1000 : null)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        {turns
          ? `${formatCompactNumber(turns)} turns in range`
          : isLoadingTurns
            ? "Loading turn volume…"
            : "Turn volume unavailable"}
      </div>
    </div>
  );
};

export const ContextTokensHeatmap = ({
  data,
  className
}: {
  data: ContextTokensHeatmapData;
  className?: string;
}) => {
  const { tokenBins, contextBins, maxCount, grid } = useMemo(() => {
    const tokenSet = new Set<number>();
    const contextSet = new Set<number>();
    let max = 0;
    const gridMap = new Map<string, number>();

    data.rows.forEach((row) => {
      const token = safeNumber(row.token_bin);
      const context = safeNumber(row.context_bin);
      const count = safeNumber(row.count);
      tokenSet.add(token);
      contextSet.add(context);
      max = Math.max(max, count);
      gridMap.set(`${context}-${token}`, count);
    });

    const tokenBins = Array.from(tokenSet.values()).sort((a, b) => a - b);
    const contextBins = Array.from(contextSet.values()).sort((a, b) => b - a);

    return { tokenBins, contextBins, maxCount: max, grid: gridMap };
  }, [data.rows]);

  const labelEvery = tokenBins.length > 20 ? 3 : tokenBins.length > 12 ? 2 : 1;
  const contextLabelEvery = contextBins.length > 12 ? 2 : 1;

  const cellColor = (count: number) => {
    if (!maxCount) return "hsl(var(--muted) / 0.2)";
    const intensity = count / maxCount;
    if (intensity === 0) return "hsl(var(--muted) / 0.25)";
    const alpha = 0.12 + intensity * 0.78;
    return `hsl(var(--primary) / ${alpha})`;
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Tokens per turn (binned)</span>
        <div className="flex items-center gap-2">
          <span>Low</span>
          <div
            className="h-2 w-24 rounded-full"
            style={{
              backgroundImage:
                "linear-gradient(90deg, hsl(var(--primary) / 0.1), hsl(var(--primary) / 0.9))"
            }}
          />
          <span>High</span>
        </div>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "auto 1fr" }}>
        <div className="flex flex-col gap-1 text-[10px] text-muted-foreground">
          {contextBins.map((bin, index) => (
            <div key={`context-${bin}`} className="h-4">
              {index % contextLabelEvery === 0 ? `${bin}%` : ""}
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${tokenBins.length}, minmax(16px, 1fr))`,
              minWidth: `${tokenBins.length * 18}px`
            }}
          >
            {contextBins.map((contextBin) =>
              tokenBins.map((tokenBin) => {
                const count = grid.get(`${contextBin}-${tokenBin}`) ?? 0;
                const contextEnd = Math.min(contextBin + 5, 100);
                const contextLabel =
                  contextBin === contextEnd
                    ? `${contextBin}%`
                    : `${contextBin}-${contextEnd}%`;
                const label = `${contextLabel} | ${tokenBin}-${tokenBin + data.token_bin_size} tokens`;
                return (
                  <div
                    key={`${contextBin}-${tokenBin}`}
                    className="h-4 rounded-sm border border-border/20"
                    style={{ background: cellColor(count) }}
                    title={`${label} · ${formatCompactNumber(count)} turns`}
                  />
                );
              })
            )}
          </div>
          <div
            className="mt-2 grid text-[10px] text-muted-foreground"
            style={{
              gridTemplateColumns: `repeat(${tokenBins.length}, minmax(16px, 1fr))`,
              minWidth: `${tokenBins.length * 18}px`
            }}
          >
            {tokenBins.map((tokenBin, index) => (
              <div key={`token-${tokenBin}`} className="text-center">
                {index % labelEvery === 0 ? tokenBin : ""}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
