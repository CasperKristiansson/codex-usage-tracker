"use client";

import type { TooltipProps } from "recharts";

import { formatCompactNumber } from "@/lib/format";

export type ChartTooltipProps = TooltipProps<number, string> & {
  labelFormatter?: (label: string) => string;
  valueFormatter?: (value: number, name?: string) => string;
};

const ChartTooltip = ({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter
}: ChartTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  const labelText = labelFormatter ? labelFormatter(String(label)) : String(label);
  const formatValue = valueFormatter ?? ((value: number) => formatCompactNumber(value));

  return (
    <div className="rounded-lg border border-border/40 bg-popover px-3 py-2 text-xs text-foreground shadow-lg">
      <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {labelText}
      </div>
      <div className="space-y-1">
        {payload.map((item) => {
          if (item.value === undefined || item.value === null) return null;
          const color = item.color || item.stroke || "#94a3b8";
          const name = item.name || String(item.dataKey);
          return (
            <div key={name} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
                {name}
              </span>
              <span className="font-mono text-foreground">
                {formatValue(Number(item.value), name)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { ChartTooltip };
