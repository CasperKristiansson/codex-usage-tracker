"use client";

import { useEffect, useMemo, useState } from "react";

import { BarList } from "@/components/charts/bar-list";
import {
  LatencyOutliers,
  LatencyTable,
  ToolTrendChart,
  type ToolErrorRates,
  type ToolLatency,
  type ToolNameCounts,
  type ToolTrend,
  type ToolTypeCounts
} from "@/components/tools/tools-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardPanel } from "@/components/state/card-panel";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { SideDrawer } from "@/components/state/side-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { SERIES_COLORS } from "@/lib/charts";
import { buildFilterQuery } from "@/lib/api";
import { isEmptyResponse } from "@/lib/data";
import { formatCompactNumber, formatPercent } from "@/lib/format";
import { useApi } from "@/lib/hooks/use-api";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useFilters } from "@/lib/hooks/use-filters";

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

type ToolCallSample = {
  rows: Array<{
    captured_at_utc: string;
    tool_type: string | null;
    tool_name: string | null;
    status: string | null;
    call_id: string | null;
    input_text: string | null;
    output_text: string | null;
    command: string | null;
    session_id: string | null;
    turn_index: number | null;
  }>;
};

export default function ToolsPage() {
  const { filters } = useFilters();
  const typeCounts = useEndpoint<ToolTypeCounts>("/api/tools/type_counts", filters);
  const errorRates = useEndpoint<ToolErrorRates>("/api/tools/error_rates", filters);
  const latency = useEndpoint<ToolLatency>("/api/tools/latency_by_tool", filters);
  const trend = useEndpoint<ToolTrend>("/api/tools/trend_top_tools", filters);

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [drawerTool, setDrawerTool] = useState<string | null>(null);

  useEffect(() => {
    const rows = typeCounts.data?.rows ?? [];
    if (!rows.length) return;
    if (!selectedType || !rows.some((row) => row.tool_type === selectedType)) {
      const firstValid = rows.find((row) => row.tool_type);
      setSelectedType(firstValid?.tool_type ?? null);
    }
  }, [typeCounts.data?.rows, selectedType]);

  const nameCountsKey = useMemo(() => {
    if (!selectedType) return null;
    const params = new URLSearchParams(buildFilterQuery(filters));
    params.set("tool_type", selectedType);
    return `/api/tools/name_counts?${params.toString()}`;
  }, [filters, selectedType]);

  const nameCounts = useApi<ToolNameCounts>(nameCountsKey, {
    disabled: !selectedType
  });

  const rangeHours = useMemo(() => {
    const start = new Date(filters.from).getTime();
    const end = new Date(filters.to).getTime();
    if (!start || !end || end <= start) return null;
    return (end - start) / (1000 * 60 * 60);
  }, [filters.from, filters.to]);

  const isSampleAllowed = rangeHours !== null && rangeHours <= 24;

  const sampleKey = useMemo(() => {
    if (!drawerTool || !isSampleAllowed) return null;
    const params = new URLSearchParams(buildFilterQuery(filters));
    params.set("tool", drawerTool);
    return `/api/debug/tool_calls_sample?${params.toString()}`;
  }, [drawerTool, filters, isSampleAllowed]);

  const samples = useApi<ToolCallSample>(sampleKey, {
    disabled: !drawerTool || !isSampleAllowed
  });

  const renderPanelState = <T,>(
    state: {
      data?: T;
      error?: Error;
      isLoading: boolean;
      refetch: () => void;
    },
    emptyLabel: string,
    render: (data: T) => JSX.Element,
    skeletonClass = "h-48 w-full"
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
          title="Tool Composition"
          subtitle="Calls by tool type"
          exportData={typeCounts.data}
          exportFileBase="tools-composition"
          expandable
          actions={
            selectedType ? <Badge className="normal-case">{selectedType}</Badge> : null
          }
        >
          {renderPanelState(
            typeCounts,
            "No tool composition data.",
            (data) => {
              const items = data.rows.map((row, index) => {
                const label = row.tool_type || "Unknown";
                const color =
                  row.tool_type === selectedType
                    ? "hsl(var(--primary))"
                    : SERIES_COLORS[index % SERIES_COLORS.length];
                return {
                  label,
                  value: row.count,
                  color,
                  onClick: row.tool_type ? () => setSelectedType(row.tool_type) : undefined
                };
              });

              return <BarList items={items} />;
            }
          )}
        </CardPanel>

        <CardPanel
          title="Tool Names"
          subtitle={
            selectedType
              ? `Top names for ${selectedType}`
              : "Select a tool type to drill down"
          }
          exportData={nameCounts.data}
          exportFileBase="tools-names"
          expandable
        >
          {selectedType
            ? renderPanelState(
                nameCounts,
                "No tool name data.",
                (data) => {
                  const items = data.rows.map((row, index) => ({
                    label: row.tool_name || "Unknown",
                    value: row.count,
                    color: SERIES_COLORS[index % SERIES_COLORS.length]
                  }));
                  return <BarList items={items} />;
                }
              )
            : null}
          {!selectedType ? (
            <EmptyState description="Pick a tool type to see the top names." />
          ) : null}
        </CardPanel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <CardPanel
          title="Tool Trends"
          subtitle="Call volume by tool over time"
          exportData={trend.data}
          exportFileBase="tools-trends"
          expandable
        >
          {renderPanelState(
            trend,
            "No tool trend data.",
            (data) => <ToolTrendChart data={data} />,
            "h-60 w-full"
          )}
        </CardPanel>
        <CardPanel
          title="Latency"
          subtitle="p50/p95 call durations with outliers"
          exportData={latency.data}
          exportFileBase="tools-latency"
          expandable
        >
          {renderPanelState(
            latency,
            "No latency data.",
            (data) => (
              <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
                <LatencyTable data={data} />
                <LatencyOutliers data={data} />
              </div>
            ),
            "h-72 w-full"
          )}
        </CardPanel>
      </section>

      <CardPanel
        title="Failures"
        subtitle="Error rate by tool (click for samples)"
        exportData={errorRates.data}
        exportFileBase="tools-failures"
        expandable
      >
        {renderPanelState(
          errorRates,
          "No failure data.",
          (data) => (
            <div className="overflow-hidden rounded-lg border border-border/20">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Tool</th>
                    <th className="px-3 py-2 text-right font-medium">Errors</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 text-right font-medium">Error rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {data.rows.map((row) => {
                    const rate = row.error_rate;
                    const rateClass =
                      rate === null || rate === undefined
                        ? "text-muted-foreground"
                        : rate >= 25
                          ? "text-rose-400"
                          : rate >= 10
                            ? "text-amber-400"
                            : "text-emerald-400";
                    return (
                      <tr
                        key={row.tool}
                        className="cursor-pointer transition hover:bg-muted/40"
                        onClick={() => setDrawerTool(row.tool)}
                      >
                        <td className="px-3 py-2 text-foreground">{row.tool}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCompactNumber(row.errors)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatCompactNumber(row.total)}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono ${rateClass}`}>
                          {formatPercent(row.error_rate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ),
          "h-60 w-full"
        )}
      </CardPanel>

      <SideDrawer
        open={Boolean(drawerTool)}
        onClose={() => setDrawerTool(null)}
        title={drawerTool ? `${drawerTool} samples` : "Samples"}
        subtitle="Limited to 24h range and 200 rows"
        actions={
          drawerTool && isSampleAllowed ? (
            <Button size="sm" variant="outline" onClick={() => samples.refetch()}>
              Refresh
            </Button>
          ) : null
        }
      >
        {!isSampleAllowed ? (
          <EmptyState
            title="Samples require a tighter range"
            description="Narrow the time range to 24h or less to load tool call samples."
          />
        ) : samples.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : samples.error ? (
          <ErrorState
            description="We could not load tool call samples."
            onRetry={samples.refetch}
          />
        ) : isEmptyResponse(samples.data) ? (
          <EmptyState description="No tool call samples for this range." />
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              Showing up to {formatCompactNumber(samples.data?.rows.length ?? 0)}
              {" "}most recent calls.
            </div>
            <div className="space-y-3">
              {samples.data?.rows.map((row, index) => (
                <div
                  key={`${row.call_id ?? "call"}-${row.captured_at_utc}-${index}`}
                  className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-foreground">
                      <span className="font-semibold">
                        {row.tool_name || row.tool_type || "Tool"}
                      </span>
                      {row.status ? (
                        <span className="rounded-full border border-border/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          {row.status}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-muted-foreground">
                      {formatTimestamp(row.captured_at_utc)}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Session {row.session_id ?? "—"} · Turn {row.turn_index ?? "—"}
                  </div>
                  {row.command ? (
                    <div className="mt-2 rounded-md bg-background/60 px-2 py-1 font-mono text-[11px] text-foreground">
                      {row.command}
                    </div>
                  ) : null}
                  {(row.input_text || row.output_text) && (
                    <div className="mt-3 space-y-2 text-[11px] text-muted-foreground">
                      {row.input_text ? (
                        <details className="rounded-md border border-border/20 bg-background/60 px-2 py-1">
                          <summary className="cursor-pointer">Input</summary>
                          <pre className="mt-2 whitespace-pre-wrap text-foreground/90">
                            {row.input_text}
                          </pre>
                        </details>
                      ) : null}
                      {row.output_text ? (
                        <details className="rounded-md border border-border/20 bg-background/60 px-2 py-1">
                          <summary className="cursor-pointer">Output</summary>
                          <pre className="mt-2 whitespace-pre-wrap text-foreground/90">
                            {row.output_text}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </SideDrawer>
    </div>
  );
}
