"use client";

import { CardPanel } from "@/components/state/card-panel";
import { DataPreview } from "@/components/state/data-preview";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { isEmptyResponse } from "@/lib/data";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useFilters } from "@/lib/hooks/use-filters";

export default function ContextPage() {
  const { filters } = useFilters();
  const histogram = useEndpoint<unknown>("/api/context/histogram", filters);
  const dangerRate = useEndpoint<unknown>(
    "/api/context/danger_rate_timeseries",
    filters
  );
  const compaction = useEndpoint<unknown>(
    "/api/context/compaction_timeseries",
    filters
  );

  const renderPanelState = (state: typeof histogram, emptyLabel?: string) => {
    if (state.isLoading) return <Skeleton className="h-48 w-full" />;
    if (state.error) return <ErrorState onRetry={state.refetch} />;
    if (isEmptyResponse(state.data))
      return <EmptyState description={emptyLabel} />;
    return <DataPreview data={state.data} />;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CardPanel
        title="Context Histogram"
        subtitle="Distribution of context remaining"
      >
        {renderPanelState(histogram, "No context distribution data.")}
      </CardPanel>
      <CardPanel
        title="Danger Rate"
        subtitle="Percent of usage under 10% context"
      >
        {renderPanelState(dangerRate, "No danger rate data.")}
      </CardPanel>
      <CardPanel
        title="Compaction & Rollbacks"
        subtitle="Trend of context mitigation events"
        className="lg:col-span-2"
      >
        {renderPanelState(compaction, "No compaction data.")}
      </CardPanel>
    </div>
  );
}
