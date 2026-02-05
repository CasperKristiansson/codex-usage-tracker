"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const progressRefetch = progress.refetch;
  const statusRefetch = status.refetch;
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const handledSyncIdRef = useRef<string | null>(null);

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
      handledSyncIdRef.current = null;
      setSyncId(payload.sync_id);
      progressRefetch();
      statusRefetch();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setIsStarting(false);
    }
  }, [filters.from, filters.to, progressRefetch, statusRefetch, settings.dbPath]);

  const statusValue = progress.data?.status;
  const isTerminal = statusValue === "completed" || statusValue === "failed";
  const isRunning = Boolean(syncId) && !isTerminal;

  const pollIntervalMs = 10_000;
  const lastPollRef = useRef(0);

  usePolling(
    () => {
      const now = Date.now();
      if (now - lastPollRef.current < pollIntervalMs - 250) return;
      lastPollRef.current = now;
      progressRefetch();
    },
    pollIntervalMs,
    Boolean(syncId) && !isTerminal
  );

  useEffect(() => {
    if (!syncId || statusValue !== "unknown") return;
    const id = window.setTimeout(() => {
      setSyncId(null);
      statusRefetch();
    }, 15_000);
    return () => window.clearTimeout(id);
  }, [syncId, statusValue, statusRefetch]);

  useEffect(() => {
    if (!syncId) return;
    if (statusValue !== "completed" && statusValue !== "failed") return;
    if (handledSyncIdRef.current === syncId) return;
    handledSyncIdRef.current = syncId;
    setSyncId(null);
    statusRefetch();
  }, [syncId, statusValue, statusRefetch]);

  return {
    status,
    progress,
    startSync,
    startError,
    isStarting,
    isRunning
  };
};
