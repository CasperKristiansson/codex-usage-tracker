"use client";

import { useMemo, useState } from "react";

import { BarList } from "@/components/charts/bar-list";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { SideDrawer } from "@/components/state/side-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { buildFilterQuery } from "@/lib/api";
import { SERIES_COLORS } from "@/lib/charts";
import { formatCompactNumber } from "@/lib/format";
import { useApi } from "@/lib/hooks/use-api";
import { useFilters } from "@/lib/hooks/use-filters";
import { useSettings } from "@/lib/hooks/use-settings";
import { formatTimestamp } from "@/lib/timezone";

export type SessionDetail = {
  session: Record<string, string | null>;
  totals?: { total_tokens?: number; turns?: number } | null;
  top_models?: Array<{ model: string; total_tokens: number }>;
  top_directories?: Array<{ directory: string; total_tokens: number }>;
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

type MessageSample = {
  rows: Array<{
    captured_at_utc: string;
    role: string | null;
    message_type: string | null;
    message: string | null;
    session_id: string | null;
    turn_index: number | null;
  }>;
};

export const SessionDetailDrawer = ({
  sessionId,
  open,
  onClose
}: {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}) => {
  const { filters } = useFilters();
  const { settings } = useSettings();
  const detailKey = sessionId ? `/api/sessions/detail?session_id=${sessionId}` : null;
  const detail = useApi<SessionDetail>(detailKey, { disabled: !sessionId });

  const [drawerState, setDrawerState] = useState(() => ({
    sessionId: sessionId ?? null,
    tab: "overview" as "overview" | "debug",
    turnInput: "",
    turnQuery: null as string | null
  }));
  const isStale = drawerState.sessionId !== sessionId;
  const activeTab = isStale ? "overview" : drawerState.tab;
  const turnInput = isStale ? "" : drawerState.turnInput;
  const turnQuery = isStale ? null : drawerState.turnQuery;
  const updateState = (patch: Partial<typeof drawerState>) => {
    setDrawerState({
      sessionId: sessionId ?? null,
      tab: activeTab,
      turnInput,
      turnQuery,
      ...patch
    });
  };

  const kpis = useMemo(() => {
    const totalTokens = detail.data?.totals?.total_tokens ?? null;
    const turns = detail.data?.totals?.turns ?? null;
    const perTurn = totalTokens && turns ? Math.round(totalTokens / turns) : null;
    return { totalTokens, turns, perTurn };
  }, [detail.data?.totals?.total_tokens, detail.data?.totals?.turns]);

  const metadata = useMemo(() => {
    const session = detail.data?.session ?? {};
    return [
      { label: "Session ID", value: session.session_id },
      { label: "CWD", value: session.cwd },
      {
        label: "Started",
        value: formatTimestamp(session.session_timestamp_utc, settings.timezone)
      },
      {
        label: "Captured",
        value: formatTimestamp(session.captured_at_utc, settings.timezone)
      },
      { label: "Source", value: session.source },
      { label: "Model provider", value: session.model_provider },
      { label: "Git branch", value: session.git_branch },
      { label: "Git commit", value: session.git_commit_hash },
      { label: "Repo", value: session.git_repository_url }
    ].filter((item) => item.value);
  }, [detail.data?.session]);

  const baseParams = useMemo(() => {
    return new URLSearchParams(buildFilterQuery(filters));
  }, [filters]);

  const toolSampleKey = useMemo(() => {
    if (!sessionId || activeTab !== "debug") return null;
    const params = new URLSearchParams(baseParams);
    params.set("session_id", sessionId);
    return `/api/debug/tool_calls_sample?${params.toString()}`;
  }, [activeTab, baseParams, sessionId]);

  const toolSamples = useApi<ToolCallSample>(toolSampleKey, {
    disabled: !sessionId || activeTab !== "debug"
  });

  const messageKey = useMemo(() => {
    if (!sessionId || !turnQuery || activeTab !== "debug") return null;
    const params = new URLSearchParams(baseParams);
    params.set("session_id", sessionId);
    params.set("turn_index", turnQuery);
    return `/api/debug/messages_sample?${params.toString()}`;
  }, [activeTab, baseParams, sessionId, turnQuery]);

  const messageSamples = useApi<MessageSample>(messageKey, {
    disabled: !sessionId || !turnQuery || activeTab !== "debug"
  });

  const turnNumber = Number(turnInput);
  const turnValid = turnInput === "" || !Number.isNaN(turnNumber);

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title={sessionId ? `Session ${sessionId}` : "Session"}
      subtitle="Overview and debug samples"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === "overview" ? "default" : "ghost"}
            size="sm"
            onClick={() => updateState({ tab: "overview" })}
          >
            Overview
          </Button>
          <Button
            variant={activeTab === "debug" ? "default" : "ghost"}
            size="sm"
            onClick={() => updateState({ tab: "debug" })}
          >
            Debug
          </Button>
        </div>
      }
    >
      {detail.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : detail.error ? (
        <ErrorState
          description="We could not load session details."
          onRetry={detail.refetch}
        />
      ) : !detail.data ? (
        <EmptyState description="No session data available." />
      ) : activeTab === "overview" ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Tokens
              </div>
              <div className="mt-2 font-mono text-xl text-foreground">
                {formatCompactNumber(kpis.totalTokens)}
              </div>
            </div>
            <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Turns
              </div>
              <div className="mt-2 font-mono text-xl text-foreground">
                {formatCompactNumber(kpis.turns)}
              </div>
            </div>
            <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Tokens/turn
              </div>
              <div className="mt-2 font-mono text-xl text-foreground">
                {kpis.perTurn ? formatCompactNumber(kpis.perTurn) : "—"}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
            <div className="text-xs font-semibold text-foreground">Session metadata</div>
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              {metadata.length ? (
                metadata.map((item) => (
                  <div key={item.label} className="flex gap-2">
                    <span className="w-28 text-foreground/80">{item.label}</span>
                    <span className="flex-1 break-all">{item.value}</span>
                  </div>
                ))
              ) : (
                <div>No metadata available.</div>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold text-foreground">Top models</div>
              {detail.data.top_models?.length ? (
                <BarList
                  items={detail.data.top_models.map((row, index) => ({
                    label: row.model,
                    value: row.total_tokens,
                    color: SERIES_COLORS[index % SERIES_COLORS.length]
                  }))}
                />
              ) : (
                <EmptyState description="No model data." />
              )}
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-foreground">Top directories</div>
              {detail.data.top_directories?.length ? (
                <BarList
                  items={detail.data.top_directories.map((row, index) => ({
                    label: row.directory,
                    value: row.total_tokens,
                    color: SERIES_COLORS[index % SERIES_COLORS.length]
                  }))}
                />
              ) : (
                <EmptyState description="No directory data." />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
            Debug endpoints are capped at 200 rows and text is truncated to 800
            characters. Use a session ID or narrow time range for safe sampling.
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-foreground">Tool calls</div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => toolSamples.refetch()}
              >
                Refresh
              </Button>
            </div>
            {toolSamples.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : toolSamples.error ? (
              <ErrorState
                description="We could not load tool call samples."
                onRetry={toolSamples.refetch}
              />
            ) : toolSamples.data?.rows.length ? (
              <div className="space-y-3">
                {toolSamples.data.rows.map((row, index) => (
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
                        {formatTimestamp(row.captured_at_utc, settings.timezone)}
                      </span>
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Turn {row.turn_index ?? "—"} · Call {row.call_id ?? "—"}
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
            ) : (
              <EmptyState description="No tool call samples for this session." />
            )}
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold text-foreground">Messages</div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={turnInput}
                onChange={(event) => updateState({ turnInput: event.target.value })}
                placeholder="Turn index"
                className="w-32"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateState({ turnQuery: turnInput.trim() })}
                disabled={!turnInput || !turnValid}
              >
                Load messages
              </Button>
              {!turnValid ? (
                <span className="text-xs text-amber-400">
                  Turn index must be a number
                </span>
              ) : null}
            </div>
            {messageSamples.isLoading ? (
              <Skeleton className="mt-3 h-40 w-full" />
            ) : messageSamples.error ? (
              <div className="mt-3">
                <ErrorState
                  description="We could not load messages for this turn."
                  onRetry={messageSamples.refetch}
                />
              </div>
            ) : messageSamples.data?.rows.length ? (
              <div className="mt-3 space-y-3">
                {messageSamples.data.rows.map((row, index) => (
                  <div
                    key={`${row.captured_at_utc}-${index}`}
                    className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="font-semibold text-foreground">
                        {row.role ?? "role"}
                      </div>
                      <span className="text-muted-foreground">
                        {formatTimestamp(row.captured_at_utc, settings.timezone)}
                      </span>
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Type {row.message_type ?? "—"}
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap text-[11px] text-foreground/90">
                      {row.message ?? "—"}
                    </pre>
                  </div>
                ))}
              </div>
            ) : turnQuery ? (
              <div className="mt-3">
                <EmptyState description="No messages for this turn." />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </SideDrawer>
  );
};
