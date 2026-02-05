"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { LegendInline } from "@/components/charts/legend-inline";
import { SERIES_COLORS, formatBucketLabel, safeNumber, uniqueBuckets } from "@/lib/charts";
import { formatCompactNumber, formatDuration } from "@/lib/format";
import { useSettings } from "@/lib/hooks/use-settings";

export type ToolTypeCounts = {
  rows: Array<{ tool_type: string; count: number }>;
  other?: { tool_type: string; count: number } | null;
};

export type ToolNameCounts = {
  rows: Array<{ tool_name: string; count: number }>;
  other?: { tool_name: string; count: number } | null;
};

export type ToolErrorRates = {
  rows: Array<{ tool: string; total: number; errors: number; error_rate: number | null }>;
};

export type ToolLatency = {
  rows: Array<{ tool: string; count: number; p50: number | null; p95: number | null }>;
};

export type ToolTrend = {
  bucket: "hour" | "day";
  rows: Array<{ bucket: string; tool: string; count: number }>;
};

const TOOLTIP_STYLE = {
  wrapperStyle: { outline: "none" }
} as const;

const buildStackedSeries = (
  series: Record<string, Array<{ bucket: string; value: number }>>
) => {
  const totals = Object.entries(series).map(([name, points]) => ({
    name,
    total: points.reduce((sum, point) => sum + safeNumber(point.value), 0)
  }));

  const other = totals.find((item) => item.name === "Other");
  const sorted = totals
    .filter((item) => item.name !== "Other")
    .sort((a, b) => b.total - a.total);
  if (other) sorted.push(other);
  const buckets = uniqueBuckets(
    Object.values(series).flatMap((points) => points)
  );

  const rows = buckets.map((bucket) => {
    const row: Record<string, number | string> = { bucket };
    sorted.forEach((item) => {
      row[item.name] = 0;
    });
    return row;
  });

  const rowMap = new Map(rows.map((row) => [row.bucket as string, row]));

  Object.entries(series).forEach(([name, points]) => {
    points.forEach((point) => {
      const row = rowMap.get(point.bucket);
      if (!row) return;
      row[name] = safeNumber(point.value);
    });
  });

  return {
    keys: sorted.map((item) => item.name),
    totals: new Map(sorted.map((item) => [item.name, item.total])),
    rows
  };
};

export const ToolTrendChart = ({
  data,
  visibleKeys
}: {
  data: ToolTrend;
  visibleKeys?: string[];
}) => {
  const { settings } = useSettings();
  const timeZone = settings.timezone;
  const { rows, keys, totals } = useMemo(() => {
    const series: Record<string, Array<{ bucket: string; value: number }>> = {};
    data.rows.forEach((row) => {
      if (!series[row.tool]) series[row.tool] = [];
      series[row.tool].push({ bucket: row.bucket, value: safeNumber(row.count) });
    });
    return buildStackedSeries(series);
  }, [data.rows]);

  const activeKeys = useMemo(
    () => (visibleKeys?.length ? keys.filter((key) => visibleKeys.includes(key)) : keys),
    [keys, visibleKeys]
  );

  const colors = useMemo(() => {
    const map = new Map<string, string>();
    activeKeys.forEach((key, index) => {
      map.set(key, SERIES_COLORS[index % SERIES_COLORS.length]);
    });
    return map;
  }, [activeKeys]);

  const legendItems = activeKeys.slice(0, 6).map((key) => ({
    label: key,
    color: colors.get(key) ?? SERIES_COLORS[0],
    value: formatCompactNumber(totals.get(key))
  }));

  return (
    <div className="space-y-3">
      <LegendInline items={legendItems} />
      <div className="h-60 w-full">
        <ResponsiveContainer debounce={150}>
          <AreaChart data={rows} margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid stroke="hsl(var(--border) / 0.2)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(value) =>
                formatBucketLabel(String(value), data.bucket, timeZone)
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
                    formatBucketLabel(value, data.bucket, timeZone)
                  }
                />
              }
            />
            {activeKeys.map((key) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stackId="tools"
                stroke={colors.get(key) ?? SERIES_COLORS[0]}
                fill={colors.get(key) ?? SERIES_COLORS[0]}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const LatencyTable = ({ data }: { data: ToolLatency }) => {
  return (
    <div className="overflow-hidden rounded-lg border border-border/20">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Tool</th>
            <th className="px-3 py-2 text-right font-medium">Calls</th>
            <th className="px-3 py-2 text-right font-medium">p50</th>
            <th className="px-3 py-2 text-right font-medium">p95</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {data.rows.map((row) => (
            <tr key={row.tool}>
              <td className="px-3 py-2 text-foreground">{row.tool}</td>
              <td className="px-3 py-2 text-right font-mono">
                {formatCompactNumber(row.count)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatDuration(row.p50)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatDuration(row.p95)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const LatencyOutliers = ({ data }: { data: ToolLatency }) => {
  const outliers = useMemo(() => {
    return [...data.rows]
      .filter((row) => row.p95 !== null && row.p95 !== undefined)
      .map((row) => ({
        tool: row.tool,
        p95: row.p95 ?? 0,
        p50: row.p50 ?? 0,
        ratio: row.p50 ? (row.p95 ?? 0) / row.p50 : null
      }))
      .sort((a, b) => b.p95 - a.p95)
      .slice(0, 6);
  }, [data.rows]);

  if (!outliers.length) {
    return (
      <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
        No latency outliers detected in this range.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
      <div className="text-xs font-semibold text-foreground">Outliers</div>
      <div className="text-[11px] text-muted-foreground">
        Highest p95 latency
      </div>
      <div className="mt-3 space-y-2 text-xs">
        {outliers.map((row) => (
          <div key={row.tool} className="flex items-center justify-between gap-3">
            <span className="truncate text-foreground">{row.tool}</span>
            <div className="text-right font-mono text-foreground">
              {formatDuration(row.p95)}
              {row.ratio ? (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {row.ratio.toFixed(1)}x
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
