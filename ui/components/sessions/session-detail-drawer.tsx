"use client";

import { useMemo } from "react";

import { BarList } from "@/components/charts/bar-list";
import { SideDrawer } from "@/components/state/side-drawer";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { SERIES_COLORS } from "@/lib/charts";
import { formatCompactNumber } from "@/lib/format";
import { useApi } from "@/lib/hooks/use-api";

export type SessionDetail = {
  session: Record<string, string | null>;
  totals?: { total_tokens?: number; turns?: number } | null;
  top_models?: Array<{ model: string; total_tokens: number }>;
  top_directories?: Array<{ directory: string; total_tokens: number }>;
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
  const detailKey = sessionId ? `/api/sessions/detail?session_id=${sessionId}` : null;
  const detail = useApi<SessionDetail>(detailKey, { disabled: !sessionId });

  const kpis = useMemo(() => {
    const totalTokens = detail.data?.totals?.total_tokens ?? null;
    const turns = detail.data?.totals?.turns ?? null;
    const perTurn =
      totalTokens && turns ? Math.round(totalTokens / turns) : null;
    return { totalTokens, turns, perTurn };
  }, [detail.data?.totals?.total_tokens, detail.data?.totals?.turns]);

  const metadata = useMemo(() => {
    const session = detail.data?.session ?? {};
    return [
      { label: "Session ID", value: session.session_id },
      { label: "CWD", value: session.cwd },
      { label: "Started", value: formatTimestamp(session.session_timestamp_utc) },
      { label: "Captured", value: formatTimestamp(session.captured_at_utc) },
      { label: "Source", value: session.source },
      { label: "Model provider", value: session.model_provider },
      { label: "Git branch", value: session.git_branch },
      { label: "Git commit", value: session.git_commit_hash },
      { label: "Repo", value: session.git_repository_url }
    ].filter((item) => item.value);
  }, [detail.data?.session]);

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title={sessionId ? `Session ${sessionId}` : "Session"}
      subtitle="Top models, directories, and totals"
    >
      {detail.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : detail.error ? (
        <ErrorState description="We could not load session details." onRetry={detail.refetch} />
      ) : !detail.data ? (
        <EmptyState description="No session data available." />
      ) : (
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
      )}
    </SideDrawer>
  );
};

