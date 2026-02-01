"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";

import {
  areFiltersDefault,
  buildParamsWithDefaults,
  DEFAULT_TOP_N,
  getDefaultFilters,
  parseFilters,
  setFilterParam
} from "@/lib/filters";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RANGE_PRESETS = [
  { value: "24h", label: "24h", hours: 24 },
  { value: "7d", label: "7d", hours: 24 * 7 },
  { value: "14d", label: "14d", hours: 24 * 14 },
  { value: "30d", label: "30d", hours: 24 * 30 },
  { value: "custom", label: "Custom" }
];

const formatDateInput = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const parseDateInput = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

const inferPreset = (from: string, to: string) => {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!start || !end || end <= start) return "custom";
  const diffHours = Math.round((end - start) / (1000 * 60 * 60));
  const match = RANGE_PRESETS.find(
    (preset) => preset.hours && Math.abs(diffHours - preset.hours) <= 2
  );
  return match ? match.value : "custom";
};

const GlobalFiltersBar = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const defaults = useMemo(() => getDefaultFilters(), []);
  const meta = useEndpoint<{ distinct?: { sources?: number } }>("/api/meta");
  const hasMultipleSources = (meta.data?.distinct?.sources ?? 0) > 1;

  useEffect(() => {
    const next = buildParamsWithDefaults(
      new URLSearchParams(searchParams.toString()),
      defaults
    );
    if (next.toString() !== searchParams.toString()) {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }
  }, [searchParams, defaults, router, pathname]);

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString()), defaults),
    [searchParams, defaults]
  );

  const rangePreset = useMemo(
    () => inferPreset(filters.from, filters.to),
    [filters.from, filters.to]
  );
  const [fromInput, setFromInput] = useState(formatDateInput(filters.from));
  const [toInput, setToInput] = useState(formatDateInput(filters.to));
  const [modelsInput, setModelsInput] = useState(filters.models.join(", "));
  const [dirsInput, setDirsInput] = useState(filters.dirs.join(", "));
  const [sourceInput, setSourceInput] = useState(filters.source.join(", "));
  const [topNInput, setTopNInput] = useState(String(filters.topN));

  useEffect(() => {
    setFromInput(formatDateInput(filters.from));
    setToInput(formatDateInput(filters.to));
    setModelsInput(filters.models.join(", "));
    setDirsInput(filters.dirs.join(", "));
    setSourceInput(filters.source.join(", "));
    setTopNInput(String(filters.topN));
  }, [
    filters.from,
    filters.to,
    filters.models,
    filters.dirs,
    filters.source,
    filters.topN
  ]);

  const debouncedModels = useDebouncedValue(modelsInput, 250);
  const debouncedDirs = useDebouncedValue(dirsInput, 250);
  const debouncedSource = useDebouncedValue(sourceInput, 250);
  const debouncedTopN = useDebouncedValue(topNInput, 250);

  const replaceParams = useCallback(
    (nextParams: URLSearchParams) => {
      if (nextParams.toString() !== searchParams.toString()) {
        router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
      }
    },
    [router, pathname, searchParams]
  );

  const updateParams = useCallback(
    (
      updates: Partial<Record<keyof typeof filters, string | number | string[]>>
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      (Object.entries(updates) as Array<
        [keyof typeof filters, string | number | string[]]
      >).forEach(([key, value]) => {
        setFilterParam(params, key, value);
      });
      replaceParams(params);
    },
    [searchParams, replaceParams]
  );

  useEffect(() => {
    updateParams({
      models: debouncedModels
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    });
  }, [debouncedModels, updateParams]);

  useEffect(() => {
    updateParams({
      dirs: debouncedDirs
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    });
  }, [debouncedDirs, updateParams]);

  useEffect(() => {
    updateParams({
      source: debouncedSource
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    });
  }, [debouncedSource, updateParams]);

  useEffect(() => {
    const numeric = Number(debouncedTopN);
    updateParams({ topN: numeric > 0 ? numeric : DEFAULT_TOP_N });
  }, [debouncedTopN, updateParams]);

  const handlePresetChange = (value: string) => {
    if (value === "custom") return;
    const now = new Date();
    const preset = RANGE_PRESETS.find((entry) => entry.value === value);
    if (!preset?.hours) return;
    const from = new Date(now.getTime() - preset.hours * 60 * 60 * 1000);
    updateParams({ from: from.toISOString(), to: now.toISOString() });
  };

  const handleCustomChange = (type: "from" | "to", value: string) => {
    const iso = parseDateInput(value);
    if (!iso) return;
    updateParams({
      [type]: iso
    } as Partial<Record<keyof typeof filters, string>>);
  };

  const handleReset = () => {
    const params = new URLSearchParams();
    params.set("from", defaults.from);
    params.set("to", defaults.to);
    params.set("bucket", defaults.bucket);
    params.set("topN", String(defaults.topN));
    replaceParams(params);
  };

  const activeFilters = !areFiltersDefault(filters, defaults);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/20 bg-card/60 px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-1">
        <Label htmlFor="range">Time range</Label>
        <select
          id="range"
          value={rangePreset}
          onChange={(event) => handlePresetChange(event.target.value)}
          className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {RANGE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="bucket">Bucket</Label>
        <select
          id="bucket"
          value={filters.bucket}
          onChange={(event) => updateParams({ bucket: event.target.value })}
          className="h-9 rounded-md border border-border/40 bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="auto">Auto</option>
          <option value="hour">Hour</option>
          <option value="day">Day</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="models">Models</Label>
        <Input
          id="models"
          placeholder="gpt-5.2-codex, gpt-5.1"
          value={modelsInput}
          onChange={(event) => setModelsInput(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="dirs">Directories</Label>
        <Input
          id="dirs"
          placeholder="/apps, /services"
          value={dirsInput}
          onChange={(event) => setDirsInput(event.target.value)}
        />
      </div>

      {hasMultipleSources ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="source">Source</Label>
          <Input
            id="source"
            placeholder="cli, app-server"
            value={sourceInput}
            onChange={(event) => setSourceInput(event.target.value)}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor="topN">Top N</Label>
        <Input
          id="topN"
          type="number"
          min={1}
          value={topNInput}
          onChange={(event) => setTopNInput(event.target.value)}
          className="w-20"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label>Custom</Label>
        <div className="flex items-center gap-2">
          <Input
            type="datetime-local"
            value={fromInput}
            onChange={(event) => {
              setFromInput(event.target.value);
              handleCustomChange("from", event.target.value);
            }}
            className="min-w-[180px]"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="datetime-local"
            value={toInput}
            onChange={(event) => {
              setToInput(event.target.value);
              handleCustomChange("to", event.target.value);
            }}
            className="min-w-[180px]"
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {activeFilters ? (
          <span className="flex h-2 w-2 rounded-full bg-primary" />
        ) : null}
        <Button variant="ghost" size="icon" onClick={handleReset} aria-label="Reset">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default GlobalFiltersBar;
