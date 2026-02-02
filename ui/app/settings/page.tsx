"use client";

import { useEffect, useState } from "react";

import { CardPanel } from "@/components/state/card-panel";
import { EmptyState } from "@/components/state/empty-state";
import { ErrorState } from "@/components/state/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import ThemeToggle from "@/components/layout/theme-toggle";
import { isEmptyResponse } from "@/lib/data";
import { useApi } from "@/lib/hooks/use-api";
import { useSettings } from "@/lib/hooks/use-settings";
import { DEFAULT_PRICING } from "@/lib/pricing";
import { formatCurrency } from "@/lib/format";

const densityOptions = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" }
];

type DbInfo = {
  active_path: string;
  default_path: string;
  exists: boolean;
  row_counts?: {
    events: number;
    tool_calls: number;
    turns: number;
    sessions: number;
  } | null;
  last_ingested_at?: string | null;
  error?: string | null;
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export default function SettingsPage() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const dbInfo = useApi<DbInfo>("/api/settings/db_info", { ttl: 60_000 });

  const [dbInput, setDbInput] = useState(settings.dbPath);
  const [testInfo, setTestInfo] = useState<DbInfo | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    setDbInput(settings.dbPath);
  }, [settings.dbPath]);

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const params = new URLSearchParams();
      if (dbInput.trim()) params.set("db", dbInput.trim());
      const res = await fetch(`/api/settings/db_info?${params.toString()}`);
      const payload = (await res.json()) as DbInfo;
      setTestInfo(payload);
    } catch {
      setTestInfo({
        active_path: dbInput,
        default_path: "",
        exists: false,
        error: "Failed to test database"
      });
    } finally {
      setIsTesting(false);
    }
  };

  const activeInfo = testInfo ?? dbInfo.data ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CardPanel title="Data source" subtitle="SQLite connection">
        {dbInfo.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : dbInfo.error ? (
          <ErrorState onRetry={dbInfo.refetch} />
        ) : isEmptyResponse(dbInfo.data) ? (
          <EmptyState description="No metadata available." />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">DB path</label>
              <Input
                value={dbInput}
                onChange={(event) => setDbInput(event.target.value)}
                placeholder={dbInfo.data?.default_path ?? ""}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleTest} disabled={isTesting}>
                {isTesting ? "Testing" : "Test connection"}
              </Button>
              <Button
                size="sm"
                onClick={() => updateSettings({ dbPath: dbInput.trim() })}
              >
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={resetSettings}>
                Reset
              </Button>
            </div>
            {activeInfo ? (
              <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                <div className="flex flex-col gap-1">
                  <span>
                    Active path: <span className="text-foreground">{activeInfo.active_path}</span>
                  </span>
                  <span>
                    Default path: <span className="text-foreground">{activeInfo.default_path}</span>
                  </span>
                  <span>
                    Exists: <span className="text-foreground">{activeInfo.exists ? "Yes" : "No"}</span>
                  </span>
                  {activeInfo.last_ingested_at ? (
                    <span>
                      Last ingested: <span className="text-foreground">{formatTimestamp(activeInfo.last_ingested_at)}</span>
                    </span>
                  ) : null}
                </div>
                {activeInfo.row_counts ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      Events: <span className="text-foreground">{activeInfo.row_counts.events}</span>
                    </div>
                    <div>
                      Tool calls: <span className="text-foreground">{activeInfo.row_counts.tool_calls}</span>
                    </div>
                    <div>
                      Turns: <span className="text-foreground">{activeInfo.row_counts.turns}</span>
                    </div>
                    <div>
                      Sessions: <span className="text-foreground">{activeInfo.row_counts.sessions}</span>
                    </div>
                  </div>
                ) : null}
                {activeInfo.error ? (
                  <div className="mt-3 text-rose-400">{activeInfo.error}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </CardPanel>

      <CardPanel title="Cost model" subtitle="Pricing per model">
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={settings.showCost}
              onChange={(event) => updateSettings({ showCost: event.target.checked })}
            />
            Show cost estimates in dashboards
          </label>
          <div className="overflow-hidden rounded-lg border border-border/20">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">Input / 1M</th>
                  <th className="px-3 py-2 text-right font-medium">Cached / 1M</th>
                  <th className="px-3 py-2 text-right font-medium">Output / 1M</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {Object.entries(DEFAULT_PRICING.models).map(([model, rates]) => (
                  <tr key={model}>
                    <td className="px-3 py-2 text-foreground">{model}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatCurrency(rates.input_rate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatCurrency(rates.cached_input_rate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatCurrency(rates.output_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardPanel>

      <CardPanel title="Appearance" subtitle="Theme + density" className="lg:col-span-2">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Theme</span>
            <ThemeToggle />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Density</span>
            <SegmentedControl
              options={densityOptions}
              value={settings.density}
              onChange={(value) => updateSettings({ density: value as "comfortable" | "compact" })}
            />
          </div>
        </div>
      </CardPanel>
    </div>
  );
}
