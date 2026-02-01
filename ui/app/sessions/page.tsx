"use client";

import { CardPanel } from "@/components/state/card-panel";
import { DataPreview } from "@/components/state/data-preview";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { isEmptyResponse } from "@/lib/data";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useFilters } from "@/lib/hooks/use-filters";

export default function SessionsPage() {
  const { filters } = useFilters();
  const sessions = useEndpoint<unknown>("/api/sessions/list", filters);
  const debug = useEndpoint<unknown>("/api/debug/tool_calls_sample", filters);

  const renderPanelState = (state: typeof sessions, emptyLabel?: string) => {
    if (state.isLoading) return <Skeleton className="h-48 w-full" />;
    if (state.error) return <ErrorState onRetry={state.refetch} />;
    if (isEmptyResponse(state.data))
      return <EmptyState description={emptyLabel} />;
    return <DataPreview data={state.data} />;
  };

  return (
    <div className="grid gap-4">
      <CardPanel
        title="Sessions"
        subtitle="Anomaly filters and saved views"
      >
        {renderPanelState(sessions, "No sessions for these filters.")}
      </CardPanel>
      <CardPanel title="Debug" subtitle="Safe, filtered samples">
        {renderPanelState(debug, "No debug samples for these filters.")}
      </CardPanel>
    </div>
  );
}
