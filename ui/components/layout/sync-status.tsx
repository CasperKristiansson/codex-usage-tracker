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
  const progressData = progress.data?.progress;
  const progressLabel = useMemo(() => {
    if (!progressData) return null;
    const parsed = progressData.files_parsed ?? 0;
    const skipped = progressData.files_skipped ?? 0;
    const total = progressData.files_total ?? 0;
    if (!total) return null;
    return `${parsed + skipped}/${total} files`;
  }, [progressData]);
  const etaLabel = useMemo(() => {
    const etaSeconds = progressData?.eta_seconds;
    if (!etaSeconds || !Number.isFinite(etaSeconds)) return null;
    const rounded = Math.max(0, Math.round(etaSeconds));
    if (rounded < 60) return `${rounded}s`;
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    if (minutes < 60) return `${minutes}m ${seconds}s`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours}h ${remMinutes}m`;
  }, [progressData]);
  const errorCount = progressData?.errors ?? 0;
  const errorSamples = useMemo(
    () => progressData?.error_samples ?? [],
    [progressData?.error_samples]
  );
  const details = useMemo(() => {
    const parts: string[] = [];
    if (progressLabel) parts.push(progressLabel);
    if (etaLabel) parts.push(`ETA ${etaLabel}`);
    if (errorCount) parts.push(`${errorCount} errors`);
    return parts.length ? ` · ${parts.join(" · ")}` : "";
  }, [progressLabel, etaLabel, errorCount]);
  const errorTitle = useMemo(() => {
    if (!errorSamples.length) return undefined;
    return errorSamples
      .map((sample) => {
        const location = sample.line
          ? `${sample.file ?? "unknown"}:${sample.line}`
          : sample.file ?? "unknown";
        const base = sample.error ? `${location}: ${sample.error}` : location;
        return sample.snippet ? `${base}\n${sample.snippet}` : base;
      })
      .join("\n\n");
  }, [errorSamples]);
  const statusTitle = useMemo(() => {
    return errorTitle ?? progress.data?.error ?? startError ?? undefined;
  }, [errorTitle, progress.data?.error, startError]);

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
      <span title={statusTitle}>
        {isRunning
          ? `Syncing${details}`
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
