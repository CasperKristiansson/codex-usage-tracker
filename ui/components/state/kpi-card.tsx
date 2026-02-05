import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type KpiCardProps = {
  label: string;
  value?: string;
  delta?: string;
  tone?: "good" | "warn" | "bad";
  isLoading?: boolean;
  testId?: string;
};

const toneMap = {
  good: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-red-400"
};

const KpiCard = ({
  label,
  value = "—",
  delta,
  tone,
  isLoading = false,
  testId
}: KpiCardProps) => {
  return (
    <div className="card-panel px-4 py-4" data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      {isLoading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <div className="mt-2 font-mono text-2xl font-semibold text-foreground">
          {value}
        </div>
      )}
      {isLoading ? (
        <Skeleton className="mt-2 h-3 w-20" />
      ) : delta ? (
        <div
          className={cn(
            "mt-1 text-xs",
            tone ? toneMap[tone] : "text-muted-foreground"
          )}
        >
          {delta}
        </div>
      ) : null}
    </div>
  );
};

export { KpiCard };
