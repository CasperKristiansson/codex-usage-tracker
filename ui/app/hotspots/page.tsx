"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  ModelDirMatrix,
  TokensDistributionChart,
  type ModelDirMatrixData,
  type TokenDistribution
} from "@/components/hotspots/hotspots-charts";
import { SessionDetailDrawer } from "@/components/sessions/session-detail-drawer";
import { Badge } from "@/components/ui/badge";
import { CardPanel } from "@/components/state/card-panel";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { buildFilterQuery } from "@/lib/api";
import { isEmptyResponse } from "@/lib/data";
import { setFilterParam } from "@/lib/filters";
import { formatCompactNumber } from "@/lib/format";
import { useApi } from "@/lib/hooks/use-api";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useFilters } from "@/lib/hooks/use-filters";
import { asRoute } from "@/lib/utils";

export type TopSessions = {
  rows: Array<{
    session_id: string;
    cwd: string | null;
    total_tokens: number;
    turns: number;
  }>;
};

export default function HotspotsPage() {
  const { filters } = useFilters();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const matrix = useEndpoint<ModelDirMatrixData>(
    "/api/hotspots/model_dir_matrix",
    filters
  );
  const distribution = useEndpoint<TokenDistribution>(
    "/api/hotspots/tokens_per_turn_distribution",
    filters
  );
  const topSessions = useEndpoint<TopSessions>(
    "/api/hotspots/top_sessions",
    filters
  );

  const [overlayModel, setOverlayModel] = useState<string>("");
  const [activeSession, setActiveSession] = useState<string | null>(null);

  const matrixModels = useMemo(() => {
    return (matrix.data?.models ?? []).filter((model) => model && model !== "Other");
  }, [matrix.data?.models]);

  const overlayEnabled =
    Boolean(overlayModel) &&
    filters.models.length === 0 &&
    matrixModels.includes(overlayModel);
  const overlayValue = overlayEnabled ? overlayModel : "";

  const overlayKey = useMemo(() => {
    if (!overlayEnabled) return null;
    const params = new URLSearchParams(
      buildFilterQuery({
        ...filters,
        models: [overlayModel]
      })
    );
    return `/api/hotspots/tokens_per_turn_distribution?${params.toString()}`;
  }, [filters, overlayEnabled, overlayModel]);

  const overlayDistribution = useApi<TokenDistribution>(overlayKey, {
    disabled: !overlayEnabled
  });

  const handleMatrixSelect = (model: string, directory: string, shiftKey: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    const nextModels = shiftKey
      ? Array.from(new Set([...filters.models, model]))
      : [model];
    const nextDirs = shiftKey
      ? Array.from(new Set([...filters.dirs, directory]))
      : [directory];
    setFilterParam(params, "models", nextModels);
    setFilterParam(params, "dirs", nextDirs);
    router.replace(asRoute(`${pathname}?${params.toString()}`), { scroll: false });
  };

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
      <CardPanel
        title="Model x Directory"
        subtitle="Top token hotspots (click to filter)"
        className="min-h-[260px]"
        exportData={matrix.data}
        exportFileBase="hotspots-model-dir"
        expandable
      >
        {renderPanelState(
          matrix,
          "No hotspot data.",
          (data) => (
            <ModelDirMatrix data={data} onSelect={handleMatrixSelect} />
          ),
          "h-64 w-full"
        )}
      </CardPanel>

      <section className="grid gap-4 lg:grid-cols-2">
        <CardPanel
          title="Tokens per Turn"
          subtitle="Distribution histogram"
          exportData={distribution.data}
          exportFileBase="hotspots-token-distribution"
          expandable
          actions={
            matrixModels.length ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Overlay</span>
                <select
                  value={overlayValue}
                  disabled={filters.models.length > 0}
                  onChange={(event) => setOverlayModel(event.target.value)}
                  className="h-8 rounded-md border border-border/40 bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
                >
                  <option value="">None</option>
                  {matrixModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
            ) : null
          }
        >
          {filters.models.length > 0 ? (
            <div className="mb-3 text-xs text-muted-foreground">
              Clear model filters to compare a single model overlay.
            </div>
          ) : null}
          {renderPanelState(
            distribution,
            "No distribution data.",
            (data) => (
              <TokensDistributionChart
                data={data}
                overlay={overlayEnabled ? overlayDistribution.data ?? null : null}
                overlayLabel={overlayEnabled ? overlayModel : undefined}
              />
            )
          )}
        </CardPanel>

        <CardPanel
          title="Top Sessions"
          subtitle="Sessions with highest usage"
          exportData={topSessions.data}
          exportFileBase="hotspots-top-sessions"
          expandable
        >
          {renderPanelState(
            topSessions,
            "No session data.",
            (data) => (
              <div className="overflow-hidden rounded-lg border border-border/20">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Session</th>
                      <th className="px-3 py-2 text-left font-medium">Directory</th>
                      <th className="px-3 py-2 text-right font-medium">Tokens</th>
                      <th className="px-3 py-2 text-right font-medium">Turns</th>
                      <th className="px-3 py-2 text-right font-medium">Tokens/turn</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {data.rows.map((row) => {
                      const perTurn = row.turns ? row.total_tokens / row.turns : null;
                      return (
                        <tr
                          key={row.session_id}
                          className="cursor-pointer transition hover:bg-muted/40"
                          onClick={() => setActiveSession(row.session_id)}
                        >
                          <td className="px-3 py-2 text-foreground">
                            <div className="flex items-center gap-2">
                              <span className="truncate">{row.session_id}</span>
                              <Badge className="normal-case">View</Badge>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <span className="truncate">{row.cwd ?? "—"}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCompactNumber(row.total_tokens)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCompactNumber(row.turns)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {perTurn ? formatCompactNumber(perTurn) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </CardPanel>
      </section>

      <SessionDetailDrawer
        sessionId={activeSession}
        open={Boolean(activeSession)}
        onClose={() => setActiveSession(null)}
      />
    </div>
  );
}
