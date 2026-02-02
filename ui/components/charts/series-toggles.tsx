"use client";

import { cn } from "@/lib/utils";

export type SeriesToggleItem = {
  key: string;
  label: string;
  color?: string;
};

type SeriesTogglesProps = {
  items: SeriesToggleItem[];
  activeKeys: string[];
  onChange: (next: string[]) => void;
  className?: string;
};

const SeriesToggles = ({
  items,
  activeKeys,
  onChange,
  className
}: SeriesTogglesProps) => {
  const handleToggle = (key: string) => {
    if (activeKeys.includes(key)) {
      if (activeKeys.length === 1) return;
      onChange(activeKeys.filter((item) => item !== key));
      return;
    }
    onChange([...activeKeys, key]);
  };

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item) => {
        const active = activeKeys.includes(item.key);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => handleToggle(item.key)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition",
              active
                ? "border-primary/40 bg-primary/15 text-foreground"
                : "border-border/30 bg-muted/20 text-muted-foreground hover:text-foreground"
            )}
          >
            {item.color ? (
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: item.color }}
              />
            ) : null}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export { SeriesToggles };
