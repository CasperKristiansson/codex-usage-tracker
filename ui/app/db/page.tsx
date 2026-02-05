"use client";

import { useMemo, useState, type ReactNode } from "react";

import { CardPanel } from "@/components/state/card-panel";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { ViewExportMenu } from "@/components/state/view-export-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { buildFilterQuery } from "@/lib/api";
import { formatCompactNumber, formatBytes } from "@/lib/format";
import { useApi } from "@/lib/hooks/use-api";
import { useFilters } from "@/lib/hooks/use-filters";
import { useSettings } from "@/lib/hooks/use-settings";
import { formatTimestamp } from "@/lib/timezone";

export type DbInsights = {
  db: {
    path: string;
    exists: boolean;
    size_bytes?: number | null;
  };
  row_counts?: Record<string, number> | null;
  table_sizes?: Array<{ name: string; rows: number; bytes?: number | null }> | null;
  ingest?: {
    ingest_version?: string | null;
    schema_version?: string | null;
    files?: number | null;
    first_ingested_at?: string | null;
    last_ingested_at?: string | null;
    ingested_range_utc?: { from?: string | null; to?: string | null } | null;
    last_ingest_stats?: {
      range?: { from?: string | null; to?: string | null } | null;
      files_skipped?: number | null;
      errors?: number | null;
      started_at?: string | null;
      updated_at?: string | null;
      error_samples?: Array<{
        file?: string;
        line?: number | null;
        error?: string;
        snippet?: string | null;
      }>;
    } | null;
  } | null;
  error?: string | null;
};

const DEFAULT_EXPORT_LIMIT = 5000;
const MAX_EXPORT_LIMIT = 50000;
const EMPTY_TABLE_SIZES: Array<{ name: string; rows: number; bytes?: number | null }> =
  [];

const parseFilename = (header: string | null) => {
  if (!header) return null;
  const match = header.match(/filename=\"?([^\";]+)\"?/i);
  return match ? match[1] : null;
};

export default function DbInsightsPage() {
  const { settings } = useSettings();
  const { filters } = useFilters();
  const insights = useApi<DbInsights>("/api/db/insights", { ttl: 60_000 });
  const [exportDataset, setExportDataset] = useState<
    "events" | "turns" | "tool_calls"
  >("events");
  const [exportLimit, setExportLimit] = useState(String(DEFAULT_EXPORT_LIMIT));
  const [exporting, setExporting] = useState<null | "json" | "csv">(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const tableSizes = insights.data?.table_sizes ?? EMPTY_TABLE_SIZES;
  const totalTableBytes = useMemo(
    () =>
      tableSizes.reduce((sum, row) => sum + (row.bytes ?? 0), 0),
    [tableSizes]
  );
  const hasTableSizes = tableSizes.some((row) => row.bytes !== null && row.bytes !== undefined);
  const sortedTables = useMemo(() => {
    const rows = [...tableSizes];
    if (hasTableSizes) {
      rows.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
    } else {
      rows.sort((a, b) => b.rows - a.rows);
    }
    return rows;
  }, [hasTableSizes, tableSizes]);

  const rowCounts = insights.data?.row_counts ?? {};

  const ingest = insights.data?.ingest ?? null;
  const lastRange = ingest?.last_ingest_stats?.range ?? null;

  const renderPanelState = <T,>(
    state: {
      data?: T;
      error?: Error;
      isLoading: boolean;
      refetch: () => void;
    },
    emptyLabel: string,
    render: (data: T) => ReactNode,
    skeletonClass = "h-40 w-full"
  ) => {
    if (state.isLoading) return <Skeleton className={skeletonClass} />;
    if (state.error)
      return (
        <ErrorState
          onRetry={state.refetch}
          description="We could not load DB insights."
        />
      );
    if (!state.data) return <EmptyState description={emptyLabel} />;
    return render(state.data as T);
  };

  const exportDatasets = useMemo(
    () => ({
      db_insights: insights.data
    }),
    [insights.data]
  );
  const canExport = insights.data?.db.exists !== false;

  const buildExportUrl = (format: "json" | "csv") => {
    const params = new URLSearchParams(buildFilterQuery(filters));
    params.set("dataset", exportDataset);
    params.set("format", format);
    const limitValue = Number(exportLimit);
    if (Number.isFinite(limitValue) && limitValue > 0) {
      params.set("limit", String(Math.min(limitValue, MAX_EXPORT_LIMIT)));
    }
    const dbPath = settings.dbPath?.trim();
    if (dbPath) {
      params.set("db", dbPath);
    }
    return `/api/db/export?${params.toString()}`;
  };

  const handleExport = async (format: "json" | "csv") => {
    if (exporting) return;
    setExportError(null);
    setExporting(format);
    try {
      const response = await fetch(buildExportUrl(format));
      if (!response.ok) {
        const text = await response.text();
        let message = `Export failed (${response.status})`;
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed?.error) message = parsed.error;
        } catch {
          if (text) message = text;
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const header = response.headers.get("Content-Disposition");
      const filename =
        parseFilename(header) ??
        `db-${exportDataset}-${new Date().toISOString().slice(0, 10)}.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Failed to export dataset."
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <ViewExportMenu title="DB Insights" filters={filters} datasets={exportDatasets} />
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <CardPanel title="Database" subtitle="File path and size" testId="db-database">
          {renderPanelState(
            insights,
            "No database metadata yet.",
            () => (
              <div className="space-y-3 text-xs">
                <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    Path
                  </div>
                  <div className="mt-2 break-all text-foreground">
                    {data.db.path}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Exists
                    </div>
                    <div className="mt-2 text-foreground">
                      {data.db.exists ? "Yes" : "No"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Size
                    </div>
                    <div className="mt-2 text-foreground">
                      {formatBytes(data.db.size_bytes ?? null)}
                    </div>
                  </div>
                </div>
                {data.error ? (
                  <div className="text-xs text-rose-400">{data.error}</div>
                ) : null}
              </div>
            ),
            "h-40 w-full"
          )}
        </CardPanel>

        <CardPanel title="Record Counts" subtitle="Key tables" testId="db-record-counts">
          {renderPanelState(
            insights,
            "No record counts available.",
            () => (
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                {Object.entries(rowCounts).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2"
                  >
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      {key.replace(/_/g, " ")}
                    </div>
                    <div className="mt-2 font-mono text-foreground">
                      {formatCompactNumber(value)}
                    </div>
                  </div>
                ))}
                {!Object.keys(rowCounts).length ? (
                  <div className="text-xs text-muted-foreground">No counts found.</div>
                ) : null}
              </div>
            ),
            "h-40 w-full"
          )}
        </CardPanel>

        <CardPanel title="Ingestion" subtitle="Coverage and metadata" testId="db-ingestion">
          {renderPanelState(
            insights,
            "No ingestion metadata yet.",
            () => (
              <div className="space-y-3 text-xs">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Last ingested
                    </div>
                    <div className="mt-2 text-foreground">
                      {formatTimestamp(ingest?.last_ingested_at, settings.timezone)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Files tracked
                    </div>
                    <div className="mt-2 text-foreground">
                      {formatCompactNumber(ingest?.files ?? null)}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    Ingested range (UTC)
                  </div>
                  <div className="mt-2 text-foreground">
                    {ingest?.ingested_range_utc?.from && ingest?.ingested_range_utc?.to
                      ? `${ingest.ingested_range_utc.from} → ${ingest.ingested_range_utc.to}`
                      : "—"}
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Schema version
                    </div>
                    <div className="mt-2 text-foreground">
                      {ingest?.schema_version ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Ingest version
                    </div>
                    <div className="mt-2 text-foreground">
                      {ingest?.ingest_version ?? "—"}
                    </div>
                  </div>
                </div>

                {lastRange ? (
                  <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      Last ingest range
                    </div>
                    <div className="mt-2 text-foreground">
                      {lastRange.from || lastRange.to
                        ? `${lastRange.from ?? "—"} → ${lastRange.to ?? "—"}`
                        : "Full history"}
                    </div>
                  </div>
                ) : null}

                {ingest?.last_ingest_stats ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                        Errors
                      </div>
                      <div className="mt-2 text-foreground">
                        {formatCompactNumber(ingest.last_ingest_stats.errors ?? 0)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                        Skipped files
                      </div>
                      <div className="mt-2 text-foreground">
                        {formatCompactNumber(ingest.last_ingest_stats.files_skipped ?? 0)}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ),
            "h-40 w-full"
          )}
        </CardPanel>
      </section>

      <CardPanel title="Table Sizes" subtitle="Approximate storage per table" testId="db-table-sizes">
        {renderPanelState(
          insights,
          "No table data available.",
          () => (
            <div className="space-y-3">
              {!hasTableSizes ? (
                <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Table size estimates are unavailable (SQLite dbstat not enabled). Showing row counts only.
                </div>
              ) : null}
              <div className="overflow-hidden rounded-lg border border-border/20">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Table</th>
                      <th className="px-3 py-2 text-right font-medium">Rows</th>
                      <th className="px-3 py-2 text-right font-medium">Size</th>
                      <th className="px-3 py-2 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {sortedTables.map((row) => {
                      const share =
                        hasTableSizes && totalTableBytes > 0
                          ? ((row.bytes ?? 0) / totalTableBytes) * 100
                          : null;
                      return (
                        <tr key={row.name}>
                          <td className="px-3 py-2 text-foreground">{row.name}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCompactNumber(row.rows)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatBytes(row.bytes ?? null)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            {share === null ? "—" : `${share.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ),
          "h-56 w-full"
        )}
      </CardPanel>

      <CardPanel
        title="Data Export"
        subtitle="Download raw tables with filters applied"
        testId="db-data-export"
      >
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Dataset</label>
              <select
                value={exportDataset}
                onChange={(event) =>
                  setExportDataset(
                    event.target.value as "events" | "turns" | "tool_calls"
                  )
                }
                className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="events">Events</option>
                <option value="turns">Turns</option>
                <option value="tool_calls">Tool calls</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Row limit</label>
              <Input
                type="number"
                min={1}
                max={MAX_EXPORT_LIMIT}
                value={exportLimit}
                onChange={(event) => setExportLimit(event.target.value)}
                className="w-32"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Format</label>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExport("json")}
                  disabled={!canExport || exporting !== null}
                >
                  {exporting === "json" ? "Exporting..." : "Export JSON"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExport("csv")}
                  disabled={!canExport || exporting !== null}
                >
                  {exporting === "csv" ? "Exporting..." : "Export CSV"}
                </Button>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Uses the active time range, model, directory, and source filters. Max {MAX_EXPORT_LIMIT} rows.
          </div>
          {exportError ? (
            <div className="text-xs text-rose-400">{exportError}</div>
          ) : null}
        </div>
      </CardPanel>
    </div>
  );
}
