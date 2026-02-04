"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SessionDetailDrawer } from "@/components/sessions/session-detail-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardPanel } from "@/components/state/card-panel";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { buildFilterQuery } from "@/lib/api";
import { isEmptyResponse } from "@/lib/data";
import { formatCompactNumber } from "@/lib/format";
import { useApi } from "@/lib/hooks/use-api";
import { useFilters } from "@/lib/hooks/use-filters";
import { useSettings } from "@/lib/hooks/use-settings";
import { formatTimestamp } from "@/lib/timezone";
import { asRoute } from "@/lib/utils";

export type SessionsList = {
  page: number;
  page_size: number;
  total: number;
  rows: Array<{
    session_id: string;
    cwd: string | null;
    cli_version: string | null;
    last_seen: string | null;
    total_tokens: number;
    turns: number;
    tags?: string[];
  }>;
};

type TurnsList = {
  page: number;
  page_size: number;
  total: number;
  rows: Array<{
    captured_at_utc: string;
    session_id: string | null;
    turn_index: number | null;
    model: string | null;
    cwd: string | null;
  }>;
};

type ToolCallsList = {
  page: number;
  page_size: number;
  total: number;
  rows: Array<{
    captured_at_utc: string;
    tool_type: string | null;
    tool_name: string | null;
    status: string | null;
    command: string | null;
    session_id: string | null;
    turn_index: number | null;
  }>;
};

type SavedView = {
  name: string;
  search: string;
  minTokens: string;
  minTurns: string;
  minTokensPerTurn: string;
  pageSize: number;
};

const STORAGE_KEY = "cut.sessions.views";
const viewOptions = [
  { value: "sessions", label: "Sessions" },
  { value: "turns", label: "Turns" },
  { value: "tool_calls", label: "Tool calls" }
];

export default function SessionsPage() {
  const { filters } = useFilters();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const activeView =
    viewParam === "turns" || viewParam === "tool_calls" ? viewParam : "sessions";

  const [search, setSearch] = useState("");
  const [minTokens, setMinTokens] = useState("");
  const [minTurns, setMinTurns] = useState("");
  const [minTokensPerTurn, setMinTokensPerTurn] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [viewName, setViewName] = useState("");
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as SavedView[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [activeSession, setActiveSession] = useState<string | null>(null);

  const filtersKey = useMemo(
    () =>
      [
        activeView,
        search,
        minTokens,
        minTurns,
        minTokensPerTurn,
        pageSize,
        filters.from,
        filters.to,
        filters.bucket,
        filters.models.join(","),
        filters.dirs.join(","),
        filters.source.join(",")
      ].join("|"),
    [
      activeView,
      search,
      minTokens,
      minTurns,
      minTokensPerTurn,
      pageSize,
      filters.from,
      filters.to,
      filters.bucket,
      filters.models,
      filters.dirs,
      filters.source
    ]
  );
  const [pageState, setPageState] = useState(() => ({
    key: filtersKey,
    page: 1
  }));
  const currentPage = pageState.key === filtersKey ? pageState.page : 1;

  const handleViewChange = (value: string) => {
    if (value === activeView) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value === "sessions") {
      params.delete("view");
    } else {
      params.set("view", value);
    }
    router.replace(asRoute(`${pathname}?${params.toString()}`), { scroll: false });
  };

  const sessionsKey = useMemo(() => {
    if (activeView !== "sessions") return null;
    const params = new URLSearchParams(buildFilterQuery(filters));
    params.set("page", String(currentPage));
    params.set("pageSize", String(pageSize));
    if (search.trim()) params.set("q", search.trim());
    if (minTokens) params.set("min_tokens", minTokens);
    if (minTurns) params.set("min_turns", minTurns);
    if (minTokensPerTurn) params.set("min_tokens_per_turn", minTokensPerTurn);
    return `/api/sessions/list?${params.toString()}`;
  }, [
    activeView,
    filters,
    currentPage,
    pageSize,
    search,
    minTokens,
    minTurns,
    minTokensPerTurn
  ]);

  const turnsKey = useMemo(() => {
    if (activeView !== "turns") return null;
    const params = new URLSearchParams(buildFilterQuery(filters));
    params.set("page", String(currentPage));
    params.set("pageSize", String(pageSize));
    if (search.trim()) params.set("q", search.trim());
    return `/api/turns/list?${params.toString()}`;
  }, [activeView, filters, currentPage, pageSize, search]);

  const toolCallsKey = useMemo(() => {
    if (activeView !== "tool_calls") return null;
    const params = new URLSearchParams(buildFilterQuery(filters));
    params.set("page", String(currentPage));
    params.set("pageSize", String(pageSize));
    if (search.trim()) params.set("q", search.trim());
    return `/api/tool_calls/list?${params.toString()}`;
  }, [activeView, filters, currentPage, pageSize, search]);
  const { settings } = useSettings();
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams(buildFilterQuery(filters));
    if (settings.dbPath?.trim()) {
      params.set("db", settings.dbPath.trim());
    }
    return params.toString();
  }, [filters, settings.dbPath]);

  const sessions = useApi<SessionsList>(sessionsKey, {
    disabled: activeView !== "sessions"
  });
  const turns = useApi<TurnsList>(turnsKey, {
    disabled: activeView !== "turns"
  });
  const toolCalls = useApi<ToolCallsList>(toolCallsKey, {
    disabled: activeView !== "tool_calls"
  });

  const totalPages = useMemo(() => {
    const total =
      activeView === "sessions"
        ? sessions.data?.total ?? 0
        : activeView === "turns"
          ? turns.data?.total ?? 0
          : toolCalls.data?.total ?? 0;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [activeView, pageSize, sessions.data?.total, toolCalls.data?.total, turns.data?.total]);

  const activeFilterTags = useMemo(() => {
    if (activeView !== "sessions") return [];
    const tags: string[] = [];
    if (search.trim()) tags.push(`Search: ${search.trim()}`);
    if (minTokens) tags.push(`Min tokens ≥ ${minTokens}`);
    if (minTurns) tags.push(`Min turns ≥ ${minTurns}`);
    if (minTokensPerTurn) tags.push(`Min tokens/turn ≥ ${minTokensPerTurn}`);
    return tags;
  }, [activeView, search, minTokens, minTurns, minTokensPerTurn]);

  const searchPlaceholder = useMemo(() => {
    if (activeView === "turns") return "Session, model, or directory";
    if (activeView === "tool_calls") return "Tool, session, or command";
    return "Session ID or directory";
  }, [activeView]);

  const persistViews = (views: SavedView[]) => {
    setSavedViews(views);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
    }
  };

  const handleSaveView = () => {
    const trimmed = viewName.trim();
    if (!trimmed) return;
    const view: SavedView = {
      name: trimmed,
      search,
      minTokens,
      minTurns,
      minTokensPerTurn,
      pageSize
    };
    const existing = savedViews.filter((item) => item.name !== trimmed);
    persistViews([view, ...existing]);
  };

  const handleApplyView = (view: SavedView) => {
    setSearch(view.search);
    setMinTokens(view.minTokens);
    setMinTurns(view.minTurns);
    setMinTokensPerTurn(view.minTokensPerTurn);
    setPageSize(view.pageSize);
    setPageState({ key: filtersKey, page: 1 });
  };

  const handleDeleteView = (name: string) => {
    persistViews(savedViews.filter((view) => view.name !== name));
  };

  const handleClearFilters = () => {
    setSearch("");
    setMinTokens("");
    setMinTurns("");
    setMinTokensPerTurn("");
    setPageState({ key: filtersKey, page: 1 });
  };

  const panelTitle =
    activeView === "turns"
      ? "Turns"
      : activeView === "tool_calls"
        ? "Tool calls"
        : "Sessions";
  const panelSubtitle =
    activeView === "turns"
      ? "Turn-level activity for the selected range"
      : activeView === "tool_calls"
        ? "Tool calls captured for the selected range"
        : "Anomaly filters, saved views, and drilldowns";
  const exportData =
    activeView === "sessions"
      ? sessions.data
      : activeView === "turns"
        ? turns.data
        : toolCalls.data;
  const exportFileBase =
    activeView === "sessions"
      ? "sessions-list"
      : activeView === "turns"
        ? "turns-list"
        : "tool-calls-list";

  const renderPanelState = <T,>(
    state: {
      data?: T;
      error?: Error;
      isLoading: boolean;
      refetch: () => void;
    },
    emptyLabel: string,
    render: (data: T) => ReactNode,
    skeletonClass = "h-48 w-full"
  ) => {
    if (state.isLoading) return <Skeleton className={skeletonClass} />;
    if (state.error) return <ErrorState onRetry={state.refetch} />;
    if (isEmptyResponse(state.data)) return <EmptyState description={emptyLabel} />;
    return render(state.data as T);
  };

  return (
    <div className="space-y-6">
      <CardPanel
        title={panelTitle}
        subtitle={panelSubtitle}
        exportData={exportData}
        exportFileBase={exportFileBase}
        queryParams={filterQuery}
        drilldown={false}
        expandable
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/20 bg-card/60 px-4 py-3 shadow-sm">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">View</label>
              <SegmentedControl
                options={viewOptions}
                value={activeView}
                onChange={handleViewChange}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Search</label>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-[220px]"
              />
            </div>
            {activeView === "sessions" ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Min tokens</label>
                  <Input
                    type="number"
                    value={minTokens}
                    onChange={(event) => setMinTokens(event.target.value)}
                    className="w-32"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Min turns</label>
                  <Input
                    type="number"
                    value={minTurns}
                    onChange={(event) => setMinTurns(event.target.value)}
                    className="w-28"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Min tokens/turn</label>
                  <Input
                    type="number"
                    value={minTokensPerTurn}
                    onChange={(event) => setMinTokensPerTurn(event.target.value)}
                    className="w-36"
                  />
                </div>
              </>
            ) : null}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Page size</label>
              <select
                value={String(pageSize)}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                Clear
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (activeView === "sessions") sessions.refetch();
                  if (activeView === "turns") turns.refetch();
                  if (activeView === "tool_calls") toolCalls.refetch();
                }}
              >
                Refresh
              </Button>
            </div>
          </div>

          {activeFilterTags.length ? (
            <div className="flex flex-wrap gap-2">
              {activeFilterTags.map((tag) => (
                <Badge key={tag} className="normal-case">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}

          {activeView === "sessions" ? (
            <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                  placeholder="Saved view name"
                  className="w-56"
                />
                <Button size="sm" variant="outline" onClick={handleSaveView}>
                  Save view
                </Button>
                {savedViews.length ? (
                  <span className="text-xs text-muted-foreground">
                    {savedViews.length} saved views
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">No saved views yet.</span>
                )}
              </div>
              {savedViews.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {savedViews.map((view) => (
                    <div
                      key={view.name}
                      className="flex items-center gap-1 rounded-full border border-border/30 bg-background/60 px-2 py-1"
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleApplyView(view)}
                      >
                        {view.name}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteView(view.name)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {activeView === "sessions"
            ? renderPanelState(
                sessions,
                "No sessions for these filters.",
                (data) => (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">
                      Showing {formatCompactNumber(data.rows.length)} sessions · Page{" "}
                      {currentPage} of {totalPages} · Total{" "}
                      {formatCompactNumber(data.total)}
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border/20">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Session</th>
                            <th className="px-3 py-2 text-left font-medium">Directory</th>
                            <th className="px-3 py-2 text-left font-medium">Last seen</th>
                            <th className="px-3 py-2 text-right font-medium">Tokens</th>
                            <th className="px-3 py-2 text-right font-medium">Turns</th>
                            <th className="px-3 py-2 text-right font-medium">
                              Tokens/turn
                            </th>
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
                                    <Badge className="normal-case">Open</Badge>
                                  </div>
                                  {row.tags?.length ? (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {row.tags.map((tag) => (
                                        <Badge key={tag} className="normal-case">
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  <span className="truncate">{row.cwd ?? "—"}</span>
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {formatTimestamp(row.last_seen, settings.timezone)}
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
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Page {currentPage} of {totalPages}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPageState({
                              key: filtersKey,
                              page: Math.max(currentPage - 1, 1)
                            })
                          }
                          disabled={currentPage <= 1}
                        >
                          Prev
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPageState({
                              key: filtersKey,
                              page: Math.min(currentPage + 1, totalPages)
                            })
                          }
                          disabled={currentPage >= totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              )
            : null}

          {activeView === "turns"
            ? renderPanelState(
                turns,
                "No turns for these filters.",
                (data) => (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">
                      Showing {formatCompactNumber(data.rows.length)} turns · Page{" "}
                      {currentPage} of {totalPages} · Total{" "}
                      {formatCompactNumber(data.total)}
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border/20">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Session</th>
                            <th className="px-3 py-2 text-right font-medium">Turn</th>
                            <th className="px-3 py-2 text-left font-medium">Model</th>
                            <th className="px-3 py-2 text-left font-medium">Directory</th>
                            <th className="px-3 py-2 text-left font-medium">Captured</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/20">
                          {data.rows.map((row, index) => (
                            <tr
                              key={`${row.session_id ?? "session"}-${row.turn_index ?? index}`}
                              className="cursor-pointer transition hover:bg-muted/40"
                              onClick={() =>
                                row.session_id ? setActiveSession(row.session_id) : null
                              }
                            >
                              <td className="px-3 py-2 text-foreground">
                                <span className="truncate">
                                  {row.session_id ?? "—"}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {row.turn_index ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {row.model ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                <span className="truncate">{row.cwd ?? "—"}</span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {formatTimestamp(row.captured_at_utc, settings.timezone)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Page {currentPage} of {totalPages}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPageState({
                              key: filtersKey,
                              page: Math.max(currentPage - 1, 1)
                            })
                          }
                          disabled={currentPage <= 1}
                        >
                          Prev
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPageState({
                              key: filtersKey,
                              page: Math.min(currentPage + 1, totalPages)
                            })
                          }
                          disabled={currentPage >= totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              )
            : null}

          {activeView === "tool_calls"
            ? renderPanelState(
                toolCalls,
                "No tool calls for these filters.",
                (data) => (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">
                      Showing {formatCompactNumber(data.rows.length)} tool calls · Page{" "}
                      {currentPage} of {totalPages} · Total{" "}
                      {formatCompactNumber(data.total)}
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border/20">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Tool</th>
                            <th className="px-3 py-2 text-left font-medium">Status</th>
                            <th className="px-3 py-2 text-left font-medium">Session</th>
                            <th className="px-3 py-2 text-right font-medium">Turn</th>
                            <th className="px-3 py-2 text-left font-medium">Command</th>
                            <th className="px-3 py-2 text-left font-medium">Captured</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/20">
                          {data.rows.map((row, index) => (
                            <tr
                              key={`${row.session_id ?? "session"}-${row.turn_index ?? index}-${row.tool_name ?? row.tool_type ?? "tool"}`}
                              className="cursor-pointer transition hover:bg-muted/40"
                              onClick={() =>
                                row.session_id ? setActiveSession(row.session_id) : null
                              }
                            >
                              <td className="px-3 py-2 text-foreground">
                                {row.tool_name || row.tool_type || "Tool"}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {row.status ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                <span className="truncate">
                                  {row.session_id ?? "—"}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {row.turn_index ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                <span className="truncate">
                                  {row.command ?? "—"}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {formatTimestamp(row.captured_at_utc, settings.timezone)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Page {currentPage} of {totalPages}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPageState({
                              key: filtersKey,
                              page: Math.max(currentPage - 1, 1)
                            })
                          }
                          disabled={currentPage <= 1}
                        >
                          Prev
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPageState({
                              key: filtersKey,
                              page: Math.min(currentPage + 1, totalPages)
                            })
                          }
                          disabled={currentPage >= totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              )
            : null}
        </div>
      </CardPanel>

      <SessionDetailDrawer
        sessionId={activeSession}
        open={Boolean(activeSession)}
        onClose={() => setActiveSession(null)}
      />
    </div>
  );
}
