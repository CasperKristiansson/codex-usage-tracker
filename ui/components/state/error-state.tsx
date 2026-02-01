import { Button } from "@/components/ui/button";

type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
};

const ErrorState = ({
  title = "Query failed",
  description = "We could not load data for these filters.",
  onRetry
}: ErrorStateProps) => {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-destructive/40 bg-destructive/10 px-6 py-10 text-center">
      <div className="text-sm font-semibold text-destructive">{title}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
};

export { ErrorState };
