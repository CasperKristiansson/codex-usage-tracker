"use client";

import { useMemo, type ReactNode } from "react";

import {
  CompactionEventsChart,
  CompactionRatesTable,
  ContextHistogramChart,
  ContextTokensHeatmap,
  DangerRateChart,
  type CompactionTimeseries,
  type ContextHistogram,
  type ContextTokensHeatmapData,
  type DangerRateTimeseries
} from "@/components/context/context-charts";
import type { VolumeTimeseries } from "@/components/overview/overview-charts";
import { CardPanel } from "@/components/state/card-panel";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { isEmptyResponse } from "@/lib/data";
import { buildFilterQuery } from "@/lib/api";
import { safeNumber } from "@/lib/charts";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useFilters } from "@/lib/hooks/use-filters";
import { useSettings } from "@/lib/hooks/use-settings";

export default function ContextPage() {
  const { filters } = useFilters();
  const histogram = useEndpoint<ContextHistogram>("/api/context/histogram", filters);
  const dangerRate = useEndpoint<DangerRateTimeseries>(
    "/api/context/danger_rate_timeseries",
    filters
  );
  const compaction = useEndpoint<CompactionTimeseries>(
    "/api/context/compaction_timeseries",
    filters
  );
  const contextHeatmap = useEndpoint<ContextTokensHeatmapData>(
    "/api/context/context_vs_tokens_scatter",
    filters
  );
  const volume = useEndpoint<VolumeTimeseries>(
    "/api/overview/volume_timeseries",
    filters,
    { ttl: 30_000 }
  );
  const { settings } = useSettings();
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams(buildFilterQuery(filters));
    if (settings.dbPath?.trim()) {
      params.set("db", settings.dbPath.trim());
    }
    return params.toString();
  }, [filters, settings.dbPath]);

  const volumeRows = volume.data?.rows ?? null;
  const totalTurns = useMemo(() => {
    if (!volumeRows) return null;
    return volumeRows.reduce(
      (sum, row) => sum + safeNumber(row.turns),
      0
    );
  }, [volumeRows]);

  const renderPanelState = <T,>(
    state: {
      data?: T;
      error?: Error;
      isLoading: boolean;
      refetch: () => void;
    },
    emptyLabel: string,
    render: (data: T) => ReactNode,
    skeletonClass = "h-56 w-full"
  ) => {
    if (state.isLoading) return <Skeleton className={skeletonClass} />;
    if (state.error) return <ErrorState onRetry={state.refetch} />;
    if (isEmptyResponse(state.data)) return <EmptyState description={emptyLabel} />;
    return render(state.data as T);
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-2">
        <CardPanel
          title="Context Histogram"
          subtitle="Distribution of context remaining"
          exportData={histogram.data}
          exportFileBase="context-histogram"
          queryParams={filterQuery}
          expandable
        >
          {renderPanelState(
            histogram,
            "No context distribution data.",
            (data) => <ContextHistogramChart data={data} />
          )}
        </CardPanel>
        <CardPanel
          title="Danger Rate"
          subtitle="Percent of usage under 10%"
          exportData={dangerRate.data}
          exportFileBase="context-danger-rate"
          queryParams={filterQuery}
          expandable
        >
          {renderPanelState(
            dangerRate,
            "No danger rate data.",
            (data) => <DangerRateChart data={data} />
          )}
        </CardPanel>
      </section>

      <CardPanel
        title="Compaction & Rollbacks"
        subtitle="Mitigation events and normalized rate"
        exportData={compaction.data}
        exportFileBase="context-compaction"
        queryParams={filterQuery}
        expandable
      >
        {renderPanelState(
          compaction,
          "No compaction data.",
          (data) => (
            <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
              <CompactionEventsChart data={data} />
              <CompactionRatesTable
                data={data}
                totalTurns={totalTurns}
                isLoadingTurns={volume.isLoading}
              />
            </div>
          ),
          "h-72 w-full"
        )}
      </CardPanel>

      <CardPanel
        title="Context vs Tokens"
        subtitle="Binned density view of context left vs tokens"
        exportData={contextHeatmap.data}
        exportFileBase="context-vs-tokens"
        queryParams={filterQuery}
        expandable
      >
        {renderPanelState(
          contextHeatmap,
          "No context vs token data.",
          (data) => <ContextTokensHeatmap data={data} />,
          "h-72 w-full"
        )}
      </CardPanel>
    </div>
  );
}
