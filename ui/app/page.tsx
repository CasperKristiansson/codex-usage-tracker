"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { BarList } from "@/components/charts/bar-list";
import {
  CostChart,
  ContextPressureChart,
  FrictionEventsChart,
  ModelShareChart,
  RateLimitChart,
  TokenMixChart,
  ToolsCompositionChart,
  VolumeChart,
  type CostTimeseries,
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
import { SeriesToggles } from "@/components/charts/series-toggles";
import { CardPanel } from "@/components/state/card-panel";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { KpiCard } from "@/components/state/kpi-card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { SERIES_COLORS, TOKEN_MIX_COLORS } from "@/lib/charts";
import { buildFilterQuery } from "@/lib/api";
import { isEmptyResponse } from "@/lib/data";
import { setFilterParam } from "@/lib/filters";
import { formatCompactNumber, formatCurrency, formatPercent } from "@/lib/format";
import { useApi } from "@/lib/hooks/use-api";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useFilters } from "@/lib/hooks/use-filters";
import { useSettings } from "@/lib/hooks/use-settings";
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

const tokenMixSeries = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_tokens"
] as const;

const rateLimitSeries = ["min_5h_left", "min_weekly_left"] as const;

const frictionSeries = [
  "context_compacted",
  "thread_rolled_back",
  "undo_completed",
  "turn_aborted",
  "entered_review_mode",
  "exited_review_mode"
];

const frictionLabels: Record<string, string> = {
  context_compacted: "Compacted",
  thread_rolled_back: "Rollback",
  undo_completed: "Undo",
  turn_aborted: "Aborted",
  entered_review_mode: "Review in",
  exited_review_mode: "Review out"
};

type OverviewKpis = {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
  cache_share?: number;
  tool_calls?: number;
  tool_error_rate?: number;
  estimated_cost?: number;
  cost_coverage?: number;
};

type EndpointState<T> = {
  data?: T;
  error?: Error;
  isLoading: boolean;
  refetch: () => void;
};

const baseKpiLabels = [
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
  const { settings } = useSettings();
  const showCost = settings.showCost;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [volumeMetric, setVolumeMetric] = useState<VolumeMetric>(
    "total_tokens"
  );
  const [tokenMixMode, setTokenMixMode] = useState<TokenMixMode>("absolute");
  const [directoryDepth, setDirectoryDepth] = useState<number>(0);
  const [tokenMixVisible, setTokenMixVisible] = useState<string[]>([
    ...tokenMixSeries
  ]);
  const [rateLimitVisible, setRateLimitVisible] = useState<string[]>([
    ...rateLimitSeries
  ]);
  const [frictionVisible, setFrictionVisible] = useState<string[]>([
    ...frictionSeries
  ]);
  const [modelShareVisible, setModelShareVisible] = useState<string[]>([]);

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
  const directoryQueryParams = useMemo(() => {
    const params = new URLSearchParams(buildFilterQuery(filters));
    params.set("depth", String(directoryDepth));
    if (settings.dbPath?.trim()) {
      params.set("db", settings.dbPath.trim());
    }
    return params.toString();
  }, [filters, directoryDepth, settings.dbPath]);
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
  const costTimeseries = useEndpoint<CostTimeseries>(
    "/api/overview/cost_timeseries",
    filters,
    { disabled: !showCost }
  );
  const weeklyQuota = useEndpoint<{ row: Record<string, unknown> | null }>(
    "/api/overview/weekly_quota",
    undefined,
    { ttl: 60_000, disabled: !showCost }
  );

  const modelSeriesKeys = useMemo(() => {
    const series =
      modelShare.data?.series && !Array.isArray(modelShare.data.series)
        ? modelShare.data.series
        : {};
    return Object.keys(series);
  }, [modelShare.data?.series]);

  useEffect(() => {
    if (!modelSeriesKeys.length) return;
    setModelShareVisible((prev) => {
      const next = prev.filter((key) => modelSeriesKeys.includes(key));
      return next.length ? next : modelSeriesKeys;
    });
  }, [modelSeriesKeys]);

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams(buildFilterQuery(filters));
    if (settings.dbPath?.trim()) {
      params.set("db", settings.dbPath.trim());
    }
    return params.toString();
  }, [filters, settings.dbPath]);

  const tokenMixToggleItems = useMemo(
    () => [
      { key: "input_tokens", label: "Input", color: TOKEN_MIX_COLORS.input_tokens },
      {
        key: "cached_input_tokens",
        label: "Cached",
        color: TOKEN_MIX_COLORS.cached_input_tokens
      },
      { key: "output_tokens", label: "Output", color: TOKEN_MIX_COLORS.output_tokens },
      {
        key: "reasoning_tokens",
        label: "Reasoning",
        color: TOKEN_MIX_COLORS.reasoning_tokens
      }
    ],
    []
  );

  const rateLimitToggleItems = useMemo(
    () => [
      { key: "min_5h_left", label: "Min 5h left", color: "#22D3EE" },
      { key: "min_weekly_left", label: "Min weekly left", color: "#A78BFA" }
    ],
    []
  );

  const frictionToggleItems = useMemo(
    () =>
      frictionSeries.map((event, index) => ({
        key: event,
        label: frictionLabels[event],
        color: SERIES_COLORS[index % SERIES_COLORS.length]
      })),
    []
  );

  const modelShareToggleItems = useMemo(
    () =>
      modelSeriesKeys.map((key, index) => ({
        key,
        label: key,
        color: SERIES_COLORS[index % SERIES_COLORS.length]
      })),
    [modelSeriesKeys]
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

  const kpiLabels = useMemo(() => {
    if (!showCost) return baseKpiLabels;
    return [...baseKpiLabels, "Estimated cost", "Cost coverage"];
  }, [showCost]);

  const kpiDisplayValues = useMemo(() => {
    if (!showCost) return kpiValues;
    return [
      ...kpiValues,
      formatCurrency(kpis.data?.estimated_cost, true),
      formatPercent(kpis.data?.cost_coverage)
    ];
  }, [showCost, kpiValues, kpis.data?.estimated_cost, kpis.data?.cost_coverage]);

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
              value={kpiDisplayValues[index]}
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
        queryParams={filterQuery}
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
        queryParams={filterQuery}
        expandable
        expandedContent={
          <div className="space-y-4">
            <SeriesToggles
              items={tokenMixToggleItems}
              activeKeys={tokenMixVisible}
              onChange={setTokenMixVisible}
            />
            {renderPanelState(tokenMix, "No token mix data for these filters.", (data) => (
              <TokenMixChart
                data={data}
                mode={tokenMixMode}
                visibleKeys={tokenMixVisible as Array<
                  "input_tokens" | "cached_input_tokens" | "output_tokens" | "reasoning_tokens"
                >}
              />
            ))}
          </div>
        }
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

      {showCost ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <CardPanel
            title="Estimated Cost"
            subtitle="Usage cost over time"
            exportData={costTimeseries.data}
            exportFileBase="overview-cost-timeseries"
            queryParams={filterQuery}
            expandable
          >
            {renderPanelState(
              costTimeseries,
              "No cost data for these filters.",
              (data) => <CostChart data={data} />
            )}
          </CardPanel>
          <CardPanel
            title="Weekly Quota"
            subtitle="Latest observed quota usage"
            queryParams={filterQuery}
            expandable
          >
            {weeklyQuota.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : weeklyQuota.error ? (
              <ErrorState onRetry={weeklyQuota.refetch} />
            ) : !weeklyQuota.data?.row ? (
              <EmptyState description="No weekly quota data yet." />
            ) : (
              <div className="space-y-4 text-sm text-foreground">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Quota tokens
                    </div>
                    <div className="mt-2 font-mono text-lg">
                      {formatCompactNumber(
                        (weeklyQuota.data.row as { quota_tokens?: number }).quota_tokens
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Quota cost
                    </div>
                    <div className="mt-2 font-mono text-lg">
                      {formatCurrency(
                        (weeklyQuota.data.row as { quota_cost?: number }).quota_cost
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Observed tokens
                    </div>
                    <div className="mt-2 font-mono text-lg">
                      {formatCompactNumber(
                        (weeklyQuota.data.row as { observed_tokens?: number }).observed_tokens
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Observed cost
                    </div>
                    <div className="mt-2 font-mono text-lg">
                      {formatCurrency(
                        (weeklyQuota.data.row as { observed_cost?: number }).observed_cost
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    Used percent:{" "}
                    <span className="text-foreground">
                      {formatPercent(
                        (weeklyQuota.data.row as { used_percent?: number }).used_percent
                      )}
                    </span>
                  </span>
                  <span>
                    Week:{" "}
                    <span className="text-foreground">
                      {(weeklyQuota.data.row as { week_start?: string }).week_start} →{" "}
                      {(weeklyQuota.data.row as { week_end?: string }).week_end}
                    </span>
                  </span>
                  <span>
                    Computed:{" "}
                    <span className="text-foreground">
                      {(weeklyQuota.data.row as { computed_at?: string }).computed_at}
                    </span>
                  </span>
                </div>
              </div>
            )}
          </CardPanel>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <CardPanel
          title="Model Share"
          subtitle="Top models over time"
          exportData={modelShare.data}
          exportFileBase="overview-model-share"
          queryParams={filterQuery}
          expandable
          expandedContent={
            <div className="space-y-4">
              {modelShareToggleItems.length ? (
                <SeriesToggles
                  items={modelShareToggleItems}
                  activeKeys={modelShareVisible}
                  onChange={setModelShareVisible}
                />
              ) : null}
              {renderPanelState(
                modelShare,
                "No model share data for these filters.",
                (data) => (
                  <ModelShareChart
                    data={data}
                    visibleKeys={modelShareVisible}
                    onSelectModel={(model, shiftKey) =>
                      updateArrayFilter("models", model, shiftKey)
                    }
                  />
                )
              )}
            </div>
          }
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
          queryParams={directoryQueryParams}
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
          queryParams={filterQuery}
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
          queryParams={filterQuery}
          expandable
          expandedContent={
            <div className="space-y-4">
              <SeriesToggles
                items={rateLimitToggleItems}
                activeKeys={rateLimitVisible}
                onChange={setRateLimitVisible}
              />
              {renderPanelState(
                rateLimit,
                "No rate limit data for these filters.",
                (data) => (
                  <RateLimitChart
                    data={data}
                    visibleKeys={rateLimitVisible as Array<
                      "min_5h_left" | "min_weekly_left"
                    >}
                  />
                )
              )}
            </div>
          }
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
          queryParams={filterQuery}
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
          queryParams={filterQuery}
          expandable
          expandedContent={
            <div className="space-y-4">
              <SeriesToggles
                items={frictionToggleItems}
                activeKeys={frictionVisible}
                onChange={setFrictionVisible}
              />
              {renderPanelState(
                frictionEvents,
                "No friction event data for these filters.",
                (data) => (
                  <FrictionEventsChart data={data} visibleKeys={frictionVisible} />
                )
              )}
            </div>
          }
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
