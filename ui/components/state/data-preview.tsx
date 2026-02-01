import { cn } from "@/lib/utils";

type DataPreviewProps = {
  data: unknown;
  className?: string;
};

const formatSample = (data: unknown) => {
  if (Array.isArray(data)) return data.slice(0, 3);
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.rows)) return record.rows.slice(0, 3);
    if (Array.isArray(record.series)) return record.series.slice(0, 3);
    return record;
  }
  return data;
};

const countRows = (data: unknown) => {
  if (Array.isArray(data)) return data.length;
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.rows)) return record.rows.length;
    if (Array.isArray(record.series)) return record.series.length;
  }
  return null;
};

const DataPreview = ({ data, className }: DataPreviewProps) => {
  const sample = formatSample(data);
  const count = countRows(data);

  return (
    <div
      className={cn(
        "rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-xs text-muted-foreground",
        className
      )}
    >
      {count !== null ? (
        <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground/80">
          {count} rows
        </div>
      ) : null}
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-foreground/80">
        {JSON.stringify(sample, null, 2)}
      </pre>
    </div>
  );
};

export { DataPreview };
