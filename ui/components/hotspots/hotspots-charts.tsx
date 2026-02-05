"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { LegendInline } from "@/components/charts/legend-inline";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ModelDirMatrixData = {
  models: string[];
  directories: string[];
  matrix: number[][];
};

export type TokenDistribution = {
  bin_size: number;
  rows: Array<{ start: number; end: number; count: number }>;
};

const TOOLTIP_STYLE = {
  wrapperStyle: { outline: "none" }
} as const;

const formatBinLabel = (label: string) => {
  const [start] = label.split("-");
  return formatCompactNumber(Number(start));
};

export const ModelDirMatrix = ({
  data,
  onSelect
}: {
  data: ModelDirMatrixData;
  onSelect?: (model: string, directory: string, shiftKey: boolean) => void;
}) => {
  const dirLabel = (dir: string) => {
    if (!dir || dir === "Other") return dir;
    const trimmed = dir.replace(/[\\/]+$/, "");
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : dir;
  };

  const maxValue = useMemo(() => {
    let max = 0;
    data.matrix.forEach((row) => {
      row.forEach((value) => {
        max = Math.max(max, value ?? 0);
      });
    });
    return max;
  }, [data.matrix]);

  const cellColor = (value: number) => {
    if (!maxValue) return "hsl(var(--muted) / 0.2)";
    const intensity = Math.max(0, value) / maxValue;
    if (intensity === 0) return "hsl(var(--muted) / 0.25)";
    const alpha = 0.12 + intensity * 0.78;
    return `hsl(var(--primary) / ${alpha})`;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Tokens by model and directory</span>
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
      <div className="overflow-x-auto">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `160px repeat(${data.directories.length}, minmax(96px, 1fr))`,
            minWidth: `${160 + data.directories.length * 96}px`
          }}
        >
          <div />
          {data.directories.map((dir) => (
            <div
              key={`dir-${dir}`}
              className="px-2 text-xs font-semibold text-muted-foreground"
              title={dir}
            >
              <div className="truncate">{dirLabel(dir)}</div>
            </div>
          ))}
          {data.models.map((model, rowIndex) => (
            <div key={`row-${model}`} className="contents">
              <div
                className="flex items-center pr-2 text-xs font-semibold text-muted-foreground"
                title={model}
              >
                <div className="truncate">{model}</div>
              </div>
              {data.directories.map((dir, colIndex) => {
                const value = data.matrix[rowIndex]?.[colIndex] ?? 0;
                const isSelectable =
                  model !== "Other" && dir !== "Other" && Boolean(onSelect);
                return (
                  <button
                    key={`${model}-${dir}`}
                    type="button"
                    disabled={!isSelectable}
                    onClick={(event) =>
                      isSelectable
                        ? onSelect?.(model, dir, event.shiftKey)
                        : undefined
                    }
                    className={cn(
                      "group flex h-10 items-center justify-center rounded-md border border-border/20 text-[11px] font-semibold text-foreground transition",
                      isSelectable
                        ? "hover:border-primary/50 hover:text-foreground"
                        : "cursor-default text-muted-foreground"
                    )}
                    style={{ background: cellColor(value) }}
                    title={`${model} • ${dir} · ${formatCompactNumber(value)} tokens`}
                  >
                    {value ? formatCompactNumber(value) : ""}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const TokensDistributionChart = ({
  data,
  overlay,
  overlayLabel
}: {
  data: TokenDistribution;
  overlay?: TokenDistribution | null;
  overlayLabel?: string;
}) => {
  const chartData = useMemo(() => {
    const baseBins = data.rows.map((row) => ({
      label: `${row.start}-${row.end}`,
      start: row.start,
      end: row.end,
      count: row.count
    }));

    const overlayMap = new Map<number, number>();
    if (overlay) {
      overlay.rows.forEach((row) => {
        const baseBin = Math.floor(row.start / data.bin_size) * data.bin_size;
        overlayMap.set(baseBin, (overlayMap.get(baseBin) ?? 0) + row.count);
      });
    }

    return baseBins.map((row) => ({
      ...row,
      overlay: overlayMap.get(row.start) ?? null
    }));
  }, [data, overlay]);

  const tickInterval = useMemo(() => {
    if (chartData.length <= 10) return 0;
    return Math.ceil(chartData.length / 8) - 1;
  }, [chartData.length]);

  const legendItems = useMemo(() => {
    const items = [{ label: "All turns", color: "hsl(var(--primary))" }];
    if (overlayLabel) {
      items.push({ label: overlayLabel, color: "#A78BFA" });
    }
    return items;
  }, [overlayLabel]);

  return (
    <div className="space-y-3">
      <LegendInline items={legendItems} />
      <div className="h-56 w-full">
        <ResponsiveContainer debounce={150}>
          <ComposedChart data={chartData} margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid stroke="hsl(var(--border) / 0.2)" vertical={false} />
            <XAxis
              dataKey="label"
              interval={tickInterval}
              tickFormatter={formatBinLabel}
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
                  labelFormatter={(value) => `${value} tokens`}
                  valueFormatter={(value, name) =>
                    name === overlayLabel
                      ? formatCompactNumber(value)
                      : formatCompactNumber(value)
                  }
                />
              }
            />
            <Bar
              dataKey="count"
              name="All turns"
              fill="hsl(var(--primary))"
              radius={[6, 6, 0, 0]}
            />
            {overlayLabel ? (
              <Line
                type="monotone"
                dataKey="overlay"
                name={overlayLabel}
                stroke="#A78BFA"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
