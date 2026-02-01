"use client";

import { CardPanel } from "@/components/state/card-panel";
import { DataPreview } from "@/components/state/data-preview";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { isEmptyResponse } from "@/lib/data";
import { useEndpoint } from "@/lib/hooks/use-endpoint";

export default function SettingsPage() {
  const meta = useEndpoint<unknown>("/api/meta", undefined, { ttl: 300_000 });

  const renderPanelState = (state: typeof meta, emptyLabel?: string) => {
    if (state.isLoading) return <Skeleton className="h-32 w-full" />;
    if (state.error) return <ErrorState onRetry={state.refetch} />;
    if (isEmptyResponse(state.data))
      return <EmptyState description={emptyLabel} />;
    return <DataPreview data={state.data} />;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CardPanel title="Data source" subtitle="SQLite connection">
        {renderPanelState(meta, "No metadata available.")}
      </CardPanel>
      <CardPanel title="Cost model" subtitle="Pricing per model">
        <EmptyState />
      </CardPanel>
      <CardPanel
        title="Appearance"
        subtitle="Theme + density"
        className="lg:col-span-2"
      >
        <EmptyState />
      </CardPanel>
    </div>
  );
}
