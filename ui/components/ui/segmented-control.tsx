import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  className
}: SegmentedControlProps<T>) => {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-border/40 bg-muted/30 p-1",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-card text-foreground shadow"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

export { SegmentedControl };
