import type { MouseEvent } from "react";

import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BarListItem = {
  label: string;
  value: number;
  color?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

type BarListProps = {
  items: BarListItem[];
  valueFormatter?: (value: number) => string;
  className?: string;
};

const BarList = ({
  items,
  valueFormatter = formatCompactNumber,
  className
}: BarListProps) => {
  const max = items.reduce((acc, item) => Math.max(acc, item.value), 0) || 1;

  return (
    <div className={cn("space-y-3", className)}>
      {items.map((item) => {
        const ratio = item.value / max;
        const percent = item.value === 0 ? 0 : Math.max(2, ratio * 100);
        const content = (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 flex-1 truncate text-foreground">
                {item.label}
              </span>
              <span className="font-mono text-foreground">
                {valueFormatter(item.value)}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted/40">
              <div
                className="h-2 rounded-full"
                style={{
                  width: `${percent}%`,
                  background: item.color ?? "hsl(var(--primary))"
                }}
              />
            </div>
          </div>
        );

        if (item.onClick) {
          return (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="w-full rounded-md text-left transition hover:bg-muted/30"
            >
              {content}
            </button>
          );
        }

        return (
          <div key={item.label} className="w-full">
            {content}
          </div>
        );
      })}
    </div>
  );
};

export { BarList };
