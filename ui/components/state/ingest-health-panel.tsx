"use client";

import { useMemo } from "react";

import { CardPanel } from "@/components/state/card-panel";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, formatPercent } from "@/lib/format";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useFilters } from "@/lib/hooks/use-filters";
import { useSettings } from "@/lib/hooks/use-settings";
import { formatTimestamp } from "@/lib/timezone";

type ErrorSample = {
  file?: string;
  line?: number | null;
  error?: string;
  snippet?: string | null;
};

type IngestHealth = {
  last_ingested_at?: string | null;
  ingested_range_utc?: { from?: string | null; to?: string | null } | null;
  last_ingest_range?: { from?: string | null; to?: string | null } | null;
  last_ingest_at?: string | null;
  files_skipped?: number | null;
  errors?: number | null;
  error_samples?: ErrorSample[];
  cost_coverage?: number | null;
};

const formatRangeLabel = (
  range: { from?: string | null; to?: string | null } | null | undefined,
  timezone: string
) => {
  if (!range) return "—";
  const from = range.from ?? null;
  const to = range.to ?? null;
  if (from && to) {
    return `${formatTimestamp(from, timezone)} → ${formatTimestamp(to, timezone)}`;
  }
  if (from) return `From ${formatTimestamp(from, timezone)}`;
  if (to) return `Up to ${formatTimestamp(to, timezone)}`;
  return "Full history";
};

const buildSampleLabel = (sample: ErrorSample) => {
  const location = sample.line
    ? `${sample.file ?? "unknown"}:${sample.line}`
    : sample.file ?? "unknown";
  const base = sample.error ? `${location}: ${sample.error}` : location;
  return sample.snippet ? `${base}\n${sample.snippet}` : base;
};

const IngestHealthPanel = () => {
  const { filters } = useFilters();
  const { settings } = useSettings();
  const health = useEndpoint<IngestHealth>("/api/ingest/health", filters, {
    ttl: 30_000
  });

  const range = health.data?.last_ingest_range ?? health.data?.ingested_range_utc;
  const rangeLabel = useMemo(
    () => formatRangeLabel(range, settings.timezone),
    [range, settings.timezone]
  );
  const rangeNote =
    health.data?.last_ingest_range
      ? "Last ingest request"
      : health.data?.ingested_range_utc
        ? "Based on DB coverage"
        : null;

  const errorSamples = health.data?.error_samples ?? [];
  const errorsCount = health.data?.errors ?? null;
  const errorSummary = errorsCount ? `${formatCompactNumber(errorsCount)} errors` : null;

  return (
    <CardPanel
      title="Ingest Health"
      subtitle="Latest ingestion status and data coverage"
      footer={
        settings.showCost
          ? undefined
          : "Enable cost estimates in Settings to see full coverage details."
      }
    >
      {health.isLoading ? (
        <Skeleton className="h-52 w-full" />
      ) : health.error ? (
        <ErrorState onRetry={health.refetch} description="We could not load ingest health." />
      ) : !health.data ? (
        <EmptyState description="No ingestion metadata yet." />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Last ingest range
              </div>
              <div className="mt-2 text-xs text-foreground">{rangeLabel}</div>
              {rangeNote ? (
                <div className="mt-1 text-[11px] text-muted-foreground">{rangeNote}</div>
              ) : null}
            </div>
            <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Last ingested
              </div>
              <div className="mt-2 text-xs text-foreground">
                {formatTimestamp(health.data.last_ingested_at, settings.timezone)}
              </div>
              {health.data.last_ingest_at ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Run completed {formatTimestamp(health.data.last_ingest_at, settings.timezone)}
                </div>
              ) : null}
            </div>
            <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Skipped files
              </div>
              <div className="mt-2 font-mono text-lg text-foreground">
                {formatCompactNumber(health.data.files_skipped)}
              </div>
              {errorSummary ? (
                <div className="mt-1 text-[11px] text-muted-foreground">{errorSummary}</div>
              ) : null}
            </div>
            <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Cost coverage
              </div>
              <div className="mt-2 font-mono text-lg text-foreground">
                {settings.showCost ? formatPercent(health.data.cost_coverage) : "—"}
              </div>
              {!settings.showCost ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Cost metrics disabled
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Error samples
            </div>
            {errorSamples.length ? (
              <div className="space-y-2">
                {errorSamples.slice(0, 3).map((sample, index) => (
                  <div
                    key={`${sample.file ?? "unknown"}-${sample.line ?? index}`}
                    className="whitespace-pre-wrap rounded-lg border border-border/20 bg-muted/10 px-3 py-2 text-xs text-foreground"
                  >
                    {buildSampleLabel(sample)}
                  </div>
                ))}
                {errorSamples.length > 3 ? (
                  <div className="text-xs text-muted-foreground">
                    +{errorSamples.length - 3} more errors not shown
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No error samples recorded.</div>
            )}
          </div>
        </div>
      )}
    </CardPanel>
  );
};

export default IngestHealthPanel;
