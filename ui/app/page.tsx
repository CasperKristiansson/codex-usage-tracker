"use client";

import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { BarList } from "@/components/charts/bar-list";
import {
  ContextPressureChart,
  FrictionEventsChart,
  ModelShareChart,
  RateLimitChart,
  TokenMixChart,
  ToolsCompositionChart,
  VolumeChart,
  type ContextPressure,
  type DangerRateTimeseries,
  type DirectoryTop,
  type FrictionEvents,
  type ModelShareTimeseries,
  type RateLimitHeadroom,
  type TokenMixMode,
  type TokenMixTimeseries,
  type ToolsComposition,
  type VolumeMetric,
  type VolumeTimeseries
} from "@/components/overview/overview-charts";
import { CardPanel } from "@/components/state/card-panel";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { KpiCard } from "@/components/state/kpi-card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { SERIES_COLORS } from "@/lib/charts";
import { buildFilterQuery } from "@/lib/api";
import { isEmptyResponse } from "@/lib/data";
import { setFilterParam } from "@/lib/filters";
import { formatCompactNumber, formatPercent } from "@/lib/format";
import { useApi } from "@/lib/hooks/use-api";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useFilters } from "@/lib/hooks/use-filters";
import { asRoute } from "@/lib/utils";

const volumeOptions: Array<{ value: VolumeMetric; label: string }> = [
  { value: "total_tokens", label: "Tokens" },
  { value: "turns", label: "Turns" },
  { value: "sessions", label: "Sessions" }
];

const tokenMixOptions: Array<{ value: TokenMixMode; label: string }> = [
  { value: "absolute", label: "Absolute" },
  { value: "percent", label: "Percent" }
];

const directoryDepthOptions = [
  { value: 0, label: "Full" },
  { value: 2, label: "Depth 2" },
  { value: 1, label: "Depth 1" }
];

type OverviewKpis = {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
  cache_share?: number;
  tool_calls?: number;
  tool_error_rate?: number;
};

type EndpointState<T> = {
  data?: T;
  error?: Error;
  isLoading: boolean;
  refetch: () => void;
};

const kpiLabels = [
  "Total tokens",
  "Input tokens",
  "Output tokens",
  "Reasoning tokens",
  "Cached input",
  "Cache share",
  "Tool calls",
  "Tool error rate"
];

export default function OverviewPage() {
  const { filters } = useFilters();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [volumeMetric, setVolumeMetric] = useState<VolumeMetric>(
    "total_tokens"
  );
  const [tokenMixMode, setTokenMixMode] = useState<TokenMixMode>("absolute");
  const [directoryDepth, setDirectoryDepth] = useState<number>(0);

  const kpis = useEndpoint<OverviewKpis>("/api/overview/kpis", filters, {
    ttl: 30_000
  });
  const volume = useEndpoint<VolumeTimeseries>(
    "/api/overview/volume_timeseries",
    filters
  );
  const tokenMix = useEndpoint<TokenMixTimeseries>(
    "/api/overview/token_mix_timeseries",
    filters
  );
  const modelShare = useEndpoint<ModelShareTimeseries>(
    "/api/overview/model_share_timeseries",
    filters
  );
  const directoryQuery = useMemo(() => {
    const params = new URLSearchParams(buildFilterQuery(filters));
    params.set("depth", String(directoryDepth));
    return `/api/overview/directory_top?${params.toString()}`;
  }, [filters, directoryDepth]);
  const directoryTop = useApi<DirectoryTop>(directoryQuery);
  const contextPressure = useEndpoint<ContextPressure>(
    "/api/overview/context_pressure",
    filters
  );
  const dangerRateSeries = useEndpoint<DangerRateTimeseries>(
    "/api/context/danger_rate_timeseries",
    filters
  );
  const rateLimit = useEndpoint<RateLimitHeadroom>(
    "/api/overview/rate_limit_headroom",
    filters
  );
  const toolsComposition = useEndpoint<ToolsComposition>(
    "/api/overview/tools_composition",
    filters
  );
  const frictionEvents = useEndpoint<FrictionEvents>(
    "/api/overview/friction_events",
    filters
  );

  const updateArrayFilter = useCallback(
    (key: "models" | "dirs", value: string, shiftKey: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      const existing = key === "models" ? filters.models : filters.dirs;
      const next = shiftKey
        ? Array.from(new Set([...existing, value]))
        : [value];
      setFilterParam(params, key, next);
      router.replace(asRoute(`${pathname}?${params.toString()}`), { scroll: false });
    },
    [filters.dirs, filters.models, pathname, router, searchParams]
  );

  const renderPanelState = <T,>(
    state: EndpointState<T>,
    emptyLabel: string,
    render: (data: T) => ReactNode,
    skeletonClass = "h-56 w-full"
  ) => {
    if (state.isLoading) return <Skeleton className={skeletonClass} />;
    if (state.error)
      return (
        <ErrorState
          onRetry={state.refetch}
          description="We could not load data for this panel."
        />
      );
    if (isEmptyResponse(state.data))
      return <EmptyState description={emptyLabel} />;
    return render(state.data as T);
  };

  const kpiValues = [
    formatCompactNumber(kpis.data?.total_tokens),
    formatCompactNumber(kpis.data?.input_tokens),
    formatCompactNumber(kpis.data?.output_tokens),
    formatCompactNumber(kpis.data?.reasoning_tokens),
    formatCompactNumber(kpis.data?.cached_input_tokens),
    formatPercent(kpis.data?.cache_share),
    formatCompactNumber(kpis.data?.tool_calls),
    formatPercent(kpis.data?.tool_error_rate)
  ];

  return (
    <div className="space-y-6">
      {kpis.error ? (
        <ErrorState onRetry={kpis.refetch} />
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpiLabels.map((label, index) => (
            <KpiCard
              key={label}
              label={label}
              value={kpiValues[index]}
              isLoading={kpis.isLoading}
            />
          ))}
        </section>
      )}

      <CardPanel
        title="Usage Volume"
        subtitle="Tokens vs work volume (turns/sessions)"
        exportData={volume.data}
        exportFileBase="overview-usage-volume"
        expandable
        actions={
          <SegmentedControl
            options={volumeOptions}
            value={volumeMetric}
            onChange={setVolumeMetric}
          />
        }
      >
        {renderPanelState(volume, "No volume data for these filters.", (data) => (
          <VolumeChart data={data} metric={volumeMetric} />
        ))}
      </CardPanel>

      <CardPanel
        title="Token Mix"
        subtitle="What drove token changes"
        exportData={tokenMix.data}
        exportFileBase="overview-token-mix"
        expandable
        actions={
          <SegmentedControl
            options={tokenMixOptions}
            value={tokenMixMode}
            onChange={setTokenMixMode}
          />
        }
      >
        {renderPanelState(tokenMix, "No token mix data for these filters.", (data) => (
          <TokenMixChart data={data} mode={tokenMixMode} />
        ))}
      </CardPanel>

      <section className="grid gap-4 lg:grid-cols-2">
        <CardPanel
          title="Model Share"
          subtitle="Top models over time"
          exportData={modelShare.data}
          exportFileBase="overview-model-share"
          expandable
        >
          {renderPanelState(
            modelShare,
            "No model share data for these filters.",
            (data) => (
              <ModelShareChart
                data={data}
                onSelectModel={(model, shiftKey) =>
                  updateArrayFilter("models", model, shiftKey)
                }
              />
            )
          )}
        </CardPanel>
        <CardPanel
          title="Directory Hotspots"
          subtitle="Directories driving usage"
          exportData={directoryTop.data}
          exportFileBase="overview-directory-hotspots"
          expandable
          actions={
            <SegmentedControl
              options={directoryDepthOptions.map((option) => ({
                value: String(option.value),
                label: option.label
              }))}
              value={String(directoryDepth)}
              onChange={(value) => setDirectoryDepth(Number(value))}
            />
          }
        >
          {renderPanelState(
            directoryTop,
            "No directory data for these filters.",
            (data) => {
              const rows = [...data.rows, ...(data.other ? [data.other] : [])];
              const items = rows.map((row, index) => ({
                label: row.label,
                value: row.total_tokens,
                color: SERIES_COLORS[index % SERIES_COLORS.length],
                onClick:
                  row.label === "Other" || row.label === "<unknown>"
                    ? undefined
                    : (event: MouseEvent<HTMLButtonElement>) =>
                        updateArrayFilter("dirs", row.label, event.shiftKey)
              }));

              return <BarList items={items} />;
            }
          )}
        </CardPanel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <CardPanel
          title="Context Pressure"
          subtitle="How close you run to context limit"
          exportData={contextPressure.data}
          exportFileBase="overview-context-pressure"
          expandable
        >
          {renderPanelState(
            contextPressure,
            "No context pressure data for these filters.",
            (data) => (
              <ContextPressureChart
                data={data}
                sparkline={dangerRateSeries.data}
              />
            ),
            "h-48 w-full"
          )}
        </CardPanel>
        <CardPanel
          title="Rate Limit Headroom"
          subtitle="Min 5h vs weekly left"
          exportData={rateLimit.data}
          exportFileBase="overview-rate-limit"
          expandable
        >
          {renderPanelState(
            rateLimit,
            "No rate limit data for these filters.",
            (data) => <RateLimitChart data={data} />
          )}
        </CardPanel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <CardPanel
          title="Tool Composition"
          subtitle="Calls by tool type"
          exportData={toolsComposition.data}
          exportFileBase="overview-tools-composition"
          expandable
        >
          {renderPanelState(
            toolsComposition,
            "No tool composition data for these filters.",
            (data) => <ToolsCompositionChart data={data} />,
            "h-56 w-full"
          )}
        </CardPanel>
        <CardPanel
          title="Workflow Friction"
          subtitle="Compaction and abort events"
          exportData={frictionEvents.data}
          exportFileBase="overview-friction-events"
          expandable
        >
          {renderPanelState(
            frictionEvents,
            "No friction event data for these filters.",
            (data) => <FrictionEventsChart data={data} />
          )}
        </CardPanel>
      </section>
    </div>
  );
}
