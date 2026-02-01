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
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { LegendInline } from "@/components/charts/legend-inline";
import {
  SERIES_COLORS,
  TOKEN_MIX_COLORS,
  formatBucketLabel,
  safeNumber,
  uniqueBuckets
} from "@/lib/charts";
import { formatCompactNumber, formatPercent } from "@/lib/format";

export type VolumeMetric = "total_tokens" | "turns" | "sessions";
export type TokenMixMode = "absolute" | "percent";

export type VolumeTimeseries = {
  bucket: "hour" | "day";
  rows: Array<{
    bucket: string;
    total_tokens?: number;
    turns?: number;
    sessions?: number;
  }>;
};

export type TokenMixTimeseries = {
  bucket: "hour" | "day";
  rows: Array<{
    bucket: string;
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
  }>;
};

export type ModelShareTimeseries = {
  bucket: "hour" | "day";
  series: Record<string, Array<{ bucket: string; value: number }>>;
  summary?: {
    rows: Array<{ model: string; total_tokens: number; turns: number }>;
    total_tokens: number;
    total_turns: number;
  };
};

export type DirectoryTop = {
  rows: Array<{ label: string; total_tokens: number }>;
  other?: { label: string; total_tokens: number } | null;
};

export type ContextPressure = {
  histogram: Array<{ bin: number; count: number }>;
  danger_rate?: number | null;
};

export type DangerRateTimeseries = {
  bucket: "hour" | "day";
  rows: Array<{ bucket: string; danger_rate: number | null }>;
};

export type RateLimitHeadroom = {
  bucket: "hour" | "day";
  rows: Array<{
    bucket: string;
    min_5h_left?: number | null;
    min_weekly_left?: number | null;
  }>;
};

export type ToolsComposition = {
  rows: Array<{ tool_type: string; count: number }>;
};

export type FrictionEvents = {
  bucket: "hour" | "day";
  rows: Array<{ bucket: string; event_type: string; count: number }>;
};

const volumeLabels: Record<VolumeMetric, string> = {
  total_tokens: "Tokens",
  turns: "Turns",
  sessions: "Sessions"
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

  const rowMap = new Map(
    rows.map((row) => [row.bucket as string, row])
  );

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

export const VolumeChart = ({
  data,
  metric
}: {
  data: VolumeTimeseries;
  metric: VolumeMetric;
}) => {
  const chartData = useMemo(
    () =>
      data.rows.map((row) => ({
        bucket: row.bucket,
        total_tokens: safeNumber(row.total_tokens),
        turns: safeNumber(row.turns),
        sessions: safeNumber(row.sessions)
      })),
    [data.rows]
  );

  return (
    <div className="h-60 w-full">
      <ResponsiveContainer>
        <AreaChart data={chartData} margin={{ left: 8, right: 16, top: 8 }}>
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.2)" vertical={false} />
          <XAxis
            dataKey="bucket"
            tickFormatter={(value) => formatBucketLabel(String(value), data.bucket)}
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
                  formatBucketLabel(value, data.bucket)
                }
                valueFormatter={(value) => formatCompactNumber(value)}
              />
            }
          />
          <Area
            type="monotone"
            dataKey={metric}
            name={volumeLabels[metric]}
            stroke="hsl(var(--primary))"
            fill="url(#volumeFill)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export const TokenMixChart = ({
  data,
  mode
}: {
  data: TokenMixTimeseries;
  mode: TokenMixMode;
}) => {
  const chartData = useMemo(() => {
    return data.rows.map((row) => {
      const input = safeNumber(row.input_tokens);
      const cached = safeNumber(row.cached_input_tokens);
      const output = safeNumber(row.output_tokens);
      const reasoning = safeNumber(row.reasoning_tokens);
      const total = input + cached + output + reasoning;
      const totalInput = input + cached;
      const cacheShare = totalInput ? (cached / totalInput) * 100 : 0;

      const display =
        mode === "percent"
          ? {
              input_tokens: total ? (input / total) * 100 : 0,
              cached_input_tokens: total ? (cached / total) * 100 : 0,
              output_tokens: total ? (output / total) * 100 : 0,
              reasoning_tokens: total ? (reasoning / total) * 100 : 0
            }
          : {
              input_tokens: input,
              cached_input_tokens: cached,
              output_tokens: output,
              reasoning_tokens: reasoning
            };

      return {
        bucket: row.bucket,
        total,
        cacheShare,
        raw_input: input,
        raw_cached: cached,
        raw_output: output,
        raw_reasoning: reasoning,
        ...display
      };
    });
  }, [data.rows, mode]);

  return (
    <div className="space-y-3">
      <LegendInline
        items={[
          { label: "Input", color: TOKEN_MIX_COLORS.input_tokens },
          { label: "Cached", color: TOKEN_MIX_COLORS.cached_input_tokens },
          { label: "Output", color: TOKEN_MIX_COLORS.output_tokens },
          { label: "Reasoning", color: TOKEN_MIX_COLORS.reasoning_tokens }
        ]}
      />
      <div className="h-60 w-full">
        <ResponsiveContainer>
          <AreaChart data={chartData} margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid stroke="hsl(var(--border) / 0.2)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(value) => formatBucketLabel(String(value), data.bucket)}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value) =>
                mode === "percent"
                  ? formatPercent(Number(value) / 100)
                  : formatCompactNumber(Number(value))
              }
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0]?.payload as
                  | (typeof chartData)[number]
                  | undefined;
                if (!row) return null;

                return (
                  <div className="rounded-lg border border-border/40 bg-popover px-3 py-2 text-xs text-foreground shadow-lg">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      {formatBucketLabel(String(label), data.bucket)}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">Total</span>
                        <span className="font-mono text-foreground">
                          {formatCompactNumber(row.total)}
                        </span>
                      </div>
                      {[
                        {
                          key: "Input",
                          color: TOKEN_MIX_COLORS.input_tokens,
                          value: row.raw_input
                        },
                        {
                          key: "Cached",
                          color: TOKEN_MIX_COLORS.cached_input_tokens,
                          value: row.raw_cached
                        },
                        {
                          key: "Output",
                          color: TOKEN_MIX_COLORS.output_tokens,
                          value: row.raw_output
                        },
                        {
                          key: "Reasoning",
                          color: TOKEN_MIX_COLORS.reasoning_tokens,
                          value: row.raw_reasoning
                        }
                      ].map((entry) => (
                        <div
                          key={entry.key}
                          className="flex items-center justify-between gap-4"
                        >
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: entry.color }}
                            />
                            {entry.key}
                          </span>
                          <span className="font-mono text-foreground">
                            {formatCompactNumber(entry.value)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-4 pt-1 text-muted-foreground">
                        <span>Cache share</span>
                        <span className="font-mono text-foreground">
                          {formatPercent(row.cacheShare / 100)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="input_tokens"
              name="Input"
              stackId="mix"
              stroke={TOKEN_MIX_COLORS.input_tokens}
              fill={TOKEN_MIX_COLORS.input_tokens}
              strokeWidth={2}
              fillOpacity={0.5}
            />
            <Area
              type="monotone"
              dataKey="cached_input_tokens"
              name="Cached"
              stackId="mix"
              stroke={TOKEN_MIX_COLORS.cached_input_tokens}
              fill={TOKEN_MIX_COLORS.cached_input_tokens}
              strokeWidth={2}
              fillOpacity={0.5}
            />
            <Area
              type="monotone"
              dataKey="output_tokens"
              name="Output"
              stackId="mix"
              stroke={TOKEN_MIX_COLORS.output_tokens}
              fill={TOKEN_MIX_COLORS.output_tokens}
              strokeWidth={2}
              fillOpacity={0.5}
            />
            <Area
              type="monotone"
              dataKey="reasoning_tokens"
              name="Reasoning"
              stackId="mix"
              stroke={TOKEN_MIX_COLORS.reasoning_tokens}
              fill={TOKEN_MIX_COLORS.reasoning_tokens}
              strokeWidth={2}
              fillOpacity={0.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const ModelShareChart = ({
  data,
  onSelectModel
}: {
  data: ModelShareTimeseries;
  onSelectModel?: (model: string, shiftKey: boolean) => void;
}) => {
  const { rows, keys, totals } = useMemo(() => {
    const series =
      data.series && !Array.isArray(data.series) ? data.series : {};
    return buildStackedSeries(series);
  }, [data.series]);

  const totalAll = useMemo(() => {
    let sum = 0;
    totals.forEach((value) => {
      sum += value;
    });
    return sum;
  }, [totals]);

  const colors = useMemo(() => {
    const map = new Map<string, string>();
    keys.forEach((key, index) => {
      map.set(key, SERIES_COLORS[index % SERIES_COLORS.length]);
    });
    return map;
  }, [keys]);

  const legendItems = keys.slice(0, 6).map((key) => ({
    label: key,
    color: colors.get(key) ?? SERIES_COLORS[0],
    value: totalAll
      ? formatPercent((totals.get(key) ?? 0) / totalAll)
      : undefined
  }));

  return (
    <div className="space-y-3">
      <LegendInline items={legendItems} />
      <div className="h-60 w-full">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid stroke="hsl(var(--border) / 0.2)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(value) => formatBucketLabel(String(value), data.bucket)}
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
                    formatBucketLabel(value, data.bucket)
                  }
                  valueFormatter={(value) => formatCompactNumber(value)}
                />
              }
            />
            {keys.map((key) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="models"
                name={key}
                fill={colors.get(key) ?? SERIES_COLORS[0]}
                onClick={(_, __, event) => {
                  if (key === "Other") return;
                  onSelectModel?.(key, Boolean(event?.shiftKey));
                }}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ModelShareSummary
        summary={data.summary?.rows ?? []}
        fallbackTotals={totals}
        totalTokens={data.summary?.total_tokens ?? totalAll}
        onSelectModel={onSelectModel}
      />
    </div>
  );
};

type ModelShareSummaryProps = {
  summary: Array<{ model: string; total_tokens: number; turns: number }>;
  fallbackTotals: Map<string, number>;
  totalTokens: number;
  onSelectModel?: (model: string, shiftKey: boolean) => void;
};

const ModelShareSummary = ({
  summary,
  fallbackTotals,
  totalTokens,
  onSelectModel
}: ModelShareSummaryProps) => {
  const rows = summary.length
    ? summary
    : Array.from(fallbackTotals.entries())
        .filter(([model]) => model !== "Other")
        .map(([model, total_tokens]) => ({
          model,
          total_tokens,
          turns: 0
        }))
        .sort((a, b) => b.total_tokens - a.total_tokens)
        .slice(0, 10);

  if (!rows.length) return null;

  return (
    <div className="rounded-lg border border-border/30 bg-muted/20">
      <div className="grid grid-cols-[1.4fr_repeat(3,0.8fr)] gap-2 border-b border-border/30 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        <span>Model</span>
        <span className="text-right">Tokens</span>
        <span className="text-right">Share</span>
        <span className="text-right">Tokens/turn</span>
      </div>
      <div className="divide-y divide-border/20">
        {rows.map((row) => {
          const share = totalTokens ? row.total_tokens / totalTokens : null;
          const perTurn =
            row.turns > 0 ? row.total_tokens / row.turns : null;
          return (
            <button
              key={row.model}
              type="button"
              onClick={(event) =>
                onSelectModel?.(row.model, event.shiftKey)
              }
              className="grid w-full grid-cols-[1.4fr_repeat(3,0.8fr)] gap-2 px-3 py-2 text-left text-xs text-foreground transition hover:bg-muted/40"
            >
              <span className="truncate">{row.model}</span>
              <span className="text-right font-mono">
                {formatCompactNumber(row.total_tokens)}
              </span>
              <span className="text-right font-mono">
                {share === null ? "—" : formatPercent(share)}
              </span>
              <span className="text-right font-mono text-muted-foreground">
                {perTurn === null ? "—" : formatCompactNumber(perTurn)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const ContextPressureChart = ({
  data,
  sparkline
}: {
  data: ContextPressure;
  sparkline?: DangerRateTimeseries;
}) => {
  const chartData = useMemo(() => {
    return (data.histogram ?? []).map((row) => ({
      bin: safeNumber(row.bin),
      count: safeNumber(row.count),
      label: `${safeNumber(row.bin)}-${safeNumber(row.bin) + 5}%`
    }));
  }, [data.histogram]);

  const dangerLabel = "10-15%";
  const dangerValue =
    data.danger_rate === null || data.danger_rate === undefined
      ? null
      : data.danger_rate / 100;

  const sparklineData = useMemo(() => {
    if (!sparkline?.rows?.length) return [];
    return sparkline.rows.map((row) => ({
      bucket: row.bucket,
      danger_rate: row.danger_rate
    }));
  }, [sparkline]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground">Danger rate</div>
          <div className="mt-1 font-mono text-2xl text-foreground">
            {formatPercent(dangerValue)}
          </div>
        </div>
        {sparklineData.length ? (
          <div className="h-16 w-[180px]">
            <ResponsiveContainer>
              <LineChart data={sparklineData} margin={{ left: 4, right: 4 }}>
                <XAxis dataKey="bucket" hide />
                <YAxis domain={[0, 100]} hide />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  content={
                    <ChartTooltip
                      labelFormatter={(value) =>
                        formatBucketLabel(
                          value,
                          sparkline?.bucket ?? "day"
                        )
                      }
                      valueFormatter={(value) => formatPercent(value / 100)}
                    />
                  }
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
        ) : null}
      </div>
      <div className="h-48 w-full">
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
              x={dangerLabel}
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
    </div>
  );
};

export const RateLimitChart = ({ data }: { data: RateLimitHeadroom }) => {
  const chartData = useMemo(
    () =>
      data.rows.map((row) => ({
        bucket: row.bucket,
        min_5h_left:
          row.min_5h_left === null || row.min_5h_left === undefined
            ? null
            : safeNumber(row.min_5h_left),
        min_weekly_left:
          row.min_weekly_left === null || row.min_weekly_left === undefined
            ? null
            : safeNumber(row.min_weekly_left)
      })),
    [data.rows]
  );

  return (
    <div className="h-60 w-full">
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
            width={52}
          />
          <ReferenceArea
            y1={0}
            y2={10}
            fill="#f87171"
            fillOpacity={0.08}
          />
          <ReferenceArea
            y1={10}
            y2={25}
            fill="#fbbf24"
            fillOpacity={0.08}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            content={
              <ChartTooltip
                labelFormatter={(value) =>
                  formatBucketLabel(value, data.bucket)
                }
                valueFormatter={(value) => formatPercent(value / 100)}
              />
            }
          />
          <Line
            type="monotone"
            dataKey="min_5h_left"
            name="Min 5h left"
            stroke="#22D3EE"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="min_weekly_left"
            name="Min weekly left"
            stroke="#A78BFA"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const frictionLabels: Record<string, string> = {
  context_compacted: "Compacted",
  thread_rolled_back: "Rollback",
  undo_completed: "Undo",
  turn_aborted: "Aborted",
  entered_review_mode: "Review in",
  exited_review_mode: "Review out"
};

export const FrictionEventsChart = ({ data }: { data: FrictionEvents }) => {
  const eventTypes = useMemo(
    () => Object.keys(frictionLabels),
    []
  );

  const chartData = useMemo(() => {
    const buckets = uniqueBuckets(
      (data.rows ?? []).map((row) => ({ bucket: row.bucket }))
    );
    const rows = buckets.map((bucket) => {
      const row: Record<string, number | string> = { bucket };
      eventTypes.forEach((event) => {
        row[event] = 0;
      });
      return row;
    });
    const rowMap = new Map(
      rows.map((row) => [row.bucket as string, row])
    );

    data.rows.forEach((entry) => {
      const row = rowMap.get(entry.bucket);
      if (!row) return;
      row[entry.event_type] = safeNumber(entry.count);
    });

    return rows;
  }, [data.rows, eventTypes]);

  const legendItems = eventTypes.map((event, index) => ({
    label: frictionLabels[event],
    color: SERIES_COLORS[index % SERIES_COLORS.length]
  }));

  return (
    <div className="space-y-3">
      <LegendInline items={legendItems.slice(0, 6)} />
      <div className="h-60 w-full">
        <ResponsiveContainer>
          <BarChart data={chartData} margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid stroke="hsl(var(--border) / 0.2)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(value) => formatBucketLabel(String(value), data.bucket)}
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
                    formatBucketLabel(value, data.bucket)
                  }
                  valueFormatter={(value) => formatCompactNumber(value)}
                />
              }
            />
            {eventTypes.map((event, index) => (
              <Bar
                key={event}
                dataKey={event}
                name={frictionLabels[event]}
                stackId="events"
                fill={SERIES_COLORS[index % SERIES_COLORS.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const ToolsCompositionChart = ({
  data
}: {
  data: ToolsComposition;
}) => {
  const chartData = useMemo(
    () =>
      data.rows.map((row) => ({
        tool_type: row.tool_type,
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
            dataKey="tool_type"
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
                labelFormatter={(value) => value}
                valueFormatter={(value) => formatCompactNumber(value)}
              />
            }
          />
          <Bar dataKey="count" name="Calls" fill="#60A5FA" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
