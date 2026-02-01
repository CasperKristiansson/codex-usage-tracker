import { cn } from "@/lib/utils";

export type LegendItem = {
  label: string;
  color: string;
  value?: string;
};

type LegendInlineProps = {
  items: LegendItem[];
  className?: string;
};

const LegendInline = ({ items, className }: LegendInlineProps) => {
  if (!items.length) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 text-xs text-muted-foreground",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: item.color }}
          />
          <span>{item.label}</span>
          {item.value ? (
            <span className="font-mono text-foreground/80">{item.value}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
};

export { LegendInline };
