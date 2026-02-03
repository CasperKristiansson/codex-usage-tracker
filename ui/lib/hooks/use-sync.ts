"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Filters } from "@/lib/filters";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useApi } from "@/lib/hooks/use-api";
import { usePolling } from "@/lib/hooks/use-polling";
import { useSettings } from "@/lib/hooks/use-settings";

export type SyncStatus = {
  last_ingested_at?: string;
  ingested_range_utc?: { from: string; to: string };
  requested_range_utc?: { from: string; to: string };
  is_missing_data?: boolean;
};

export type SyncProgress = {
  sync_id: string;
  status: "running" | "completed" | "failed" | "unknown";
  progress?: {
    files_total?: number;
    files_parsed?: number;
    files_skipped?: number;
    errors?: number;
    lines?: number;
    events?: number;
    started_at?: number;
    updated_at?: number;
    eta_seconds?: number;
    current_file?: string | null;
    error_samples?: Array<{
      file?: string;
      line?: number | null;
      error?: string;
      snippet?: string | null;
    }>;
  };
  error?: string;
};

export const useSync = (filters: Filters) => {
  const status = useEndpoint<SyncStatus>("/api/sync/status", filters, {
    ttl: 10_000
  });
  const { settings } = useSettings();
  const [syncId, setSyncId] = useState<string | null>(null);
  const progressKey = useMemo(
    () => (syncId ? `/api/sync/progress?sync_id=${syncId}` : null),
    [syncId]
  );
  const progress = useApi<SyncProgress>(progressKey, {
    ttl: 1_000,
    disabled: !syncId
  });
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const startSync = useCallback(async () => {
    setIsStarting(true);
    setStartError(null);
    try {
      const params = new URLSearchParams();
      if (settings.dbPath?.trim()) {
        params.set("db", settings.dbPath.trim());
      }
      const url = params.toString() ? `/api/sync/start?${params.toString()}` : "/api/sync/start";
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ from: filters.from, to: filters.to })
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || response.statusText);
      }
      const payload = (await response.json()) as { sync_id?: string };
      if (!payload.sync_id) {
        throw new Error("Sync ID missing from response");
      }
      setSyncId(payload.sync_id);
      progress.refetch();
      status.refetch();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setIsStarting(false);
    }
  }, [filters.from, filters.to, progress, status, settings.dbPath]);

  const isRunning = progress.data?.status === "running";

  usePolling(() => progress.refetch(), 2_000, Boolean(syncId) && isRunning);

  useEffect(() => {
    if (!progress.data) return;
    if (progress.data.status === "completed" || progress.data.status === "failed") {
      setSyncId(null);
      status.refetch();
    }
  }, [progress.data, status]);

  return {
    status,
    progress,
    startSync,
    startError,
    isStarting,
    isRunning
  };
};
