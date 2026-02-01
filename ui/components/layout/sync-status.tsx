"use client";

import { useMemo } from "react";
import { AlertTriangle, CircleCheck, RefreshCcw } from "lucide-react";

import { useFilters } from "@/lib/hooks/use-filters";
import { useSync } from "@/lib/hooks/use-sync";
import { Button } from "@/components/ui/button";

const SyncStatus = () => {
  const { filters } = useFilters();
  const { status, progress, startSync, startError, isStarting, isRunning } =
    useSync(filters);

  const isMissing = status.data?.is_missing_data;
  const progressLabel = useMemo(() => {
    const progressData = progress.data?.progress;
    if (!progressData) return null;
    const parsed = progressData.files_parsed ?? 0;
    const total = progressData.files_total ?? 0;
    if (!total) return null;
    return `${parsed}/${total} files`;
  }, [progress.data]);

  const isError = Boolean(startError || progress.data?.status === "failed");

  if (!isMissing && !isRunning && !isError) return null;

  return (
    <div className="flex items-center gap-3 rounded-full border border-border/30 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
      {isRunning ? (
        <RefreshCcw className="h-3.5 w-3.5 animate-spin text-primary" />
      ) : isError || isMissing ? (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
      ) : (
        <CircleCheck className="h-3.5 w-3.5 text-emerald-400" />
      )}
      <span>
        {isRunning
          ? `Syncing${progressLabel ? ` · ${progressLabel}` : ""}`
          : isError
            ? "Sync failed"
            : "Data missing for this range"}
      </span>
      {isMissing && !isRunning ? (
        <Button
          size="sm"
          variant="outline"
          onClick={startSync}
          disabled={isStarting}
        >
          {isStarting ? "Starting" : "Sync now"}
        </Button>
      ) : null}
    </div>
  );
};

export default SyncStatus;
