"use client";

import { CardPanel } from "@/components/state/card-panel";
import { DataPreview } from "@/components/state/data-preview";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { isEmptyResponse } from "@/lib/data";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useFilters } from "@/lib/hooks/use-filters";

export default function ToolsPage() {
  const { filters } = useFilters();
  const typeCounts = useEndpoint<unknown>("/api/tools/type_counts", filters);
  const errorRates = useEndpoint<unknown>("/api/tools/error_rates", filters);
  const latency = useEndpoint<unknown>("/api/tools/latency_by_tool", filters);

  const renderPanelState = (state: typeof typeCounts, emptyLabel?: string) => {
    if (state.isLoading) return <Skeleton className="h-48 w-full" />;
    if (state.error) return <ErrorState onRetry={state.refetch} />;
    if (isEmptyResponse(state.data))
      return <EmptyState description={emptyLabel} />;
    return <DataPreview data={state.data} />;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CardPanel title="Tool Composition" subtitle="Calls by tool type">
        {renderPanelState(typeCounts, "No tool composition data.")}
      </CardPanel>
      <CardPanel title="Failures" subtitle="Error rate by tool">
        {renderPanelState(errorRates, "No failure data.")}
      </CardPanel>
      <CardPanel
        title="Latency"
        subtitle="p50/p95 by tool"
        className="lg:col-span-2"
      >
        {renderPanelState(latency, "No latency data.")}
      </CardPanel>
    </div>
  );
}
