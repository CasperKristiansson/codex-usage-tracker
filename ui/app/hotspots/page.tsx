"use client";

import { CardPanel } from "@/components/state/card-panel";
import { DataPreview } from "@/components/state/data-preview";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { isEmptyResponse } from "@/lib/data";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useFilters } from "@/lib/hooks/use-filters";

export default function HotspotsPage() {
  const { filters } = useFilters();
  const matrix = useEndpoint<unknown>("/api/hotspots/model_dir_matrix", filters);
  const distribution = useEndpoint<unknown>(
    "/api/hotspots/tokens_per_turn_distribution",
    filters
  );
  const topSessions = useEndpoint<unknown>(
    "/api/hotspots/top_sessions",
    filters
  );

  const renderPanelState = (state: typeof matrix, emptyLabel?: string) => {
    if (state.isLoading) return <Skeleton className="h-48 w-full" />;
    if (state.error) return <ErrorState onRetry={state.refetch} />;
    if (isEmptyResponse(state.data))
      return <EmptyState description={emptyLabel} />;
    return <DataPreview data={state.data} />;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CardPanel
        title="Model x Directory"
        subtitle="Top token hotspots"
        className="lg:col-span-2"
      >
        {renderPanelState(matrix, "No hotspot data.")}
      </CardPanel>
      <CardPanel
        title="Tokens per Turn"
        subtitle="Distribution histogram"
      >
        {renderPanelState(distribution, "No distribution data.")}
      </CardPanel>
      <CardPanel
        title="Top Sessions"
        subtitle="Sessions with highest usage"
      >
        {renderPanelState(topSessions, "No session data.")}
      </CardPanel>
    </div>
  );
}
