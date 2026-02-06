"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  buildParamsWithDefaults,
  DEFAULT_TOP_N,
  getDefaultFilters,
  parseFilters,
  setFilterParam
} from "@/lib/filters";
import { useEndpoint } from "@/lib/hooks/use-endpoint";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useSettings } from "@/lib/hooks/use-settings";
import {
  formatDateTimeInput,
  parseDateTimeInput,
  parseIsoToMs,
  toZonedIso
} from "@/lib/timezone";
import { asRoute } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/ui/tag-input";

const RANGE_PRESETS = [
  { value: "all", label: "All time" },
  { value: "24h", label: "24h", hours: 24 },
  { value: "7d", label: "7d", hours: 24 * 7 },
  { value: "14d", label: "14d", hours: 24 * 14 },
  { value: "30d", label: "30d", hours: 24 * 30 },
  { value: "90d", label: "90d", hours: 24 * 90 },
  { value: "180d", label: "180d", hours: 24 * 180 },
  { value: "custom", label: "Custom" }
];

type FilterOptions = {
  models: string[];
  directories: string[];
  sources: string[];
};

type MetaResponse = {
  distinct?: { sources?: number };
  min_timestamp_utc?: string | null;
  max_timestamp_utc?: string | null;
};

const inferPreset = (from: string, to: string) => {
  const start = parseIsoToMs(from);
  const end = parseIsoToMs(to);
  if (start === null || end === null || end <= start) return "custom";
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
  const { settings } = useSettings();
  const timeZone = settings.timezone;
  const defaults = useMemo(() => getDefaultFilters(timeZone), [timeZone]);
  const meta = useEndpoint<MetaResponse>("/api/meta");
  const hasMultipleSources = (meta.data?.distinct?.sources ?? 0) > 1;

  const rangeParam = searchParams.get("range") ?? "";
  const resolveAllTimeRange = useCallback(() => {
    const minMs = parseIsoToMs(meta.data?.min_timestamp_utc ?? null);
    const maxMs = parseIsoToMs(meta.data?.max_timestamp_utc ?? null);
    const fromDate = minMs !== null ? new Date(minMs) : new Date(0);
    // Add a small buffer so second-precision filters include fractional-second rows.
    const toDate = maxMs !== null ? new Date(maxMs + 1000) : new Date();
    return {
      from: toZonedIso(fromDate, timeZone),
      to: toZonedIso(toDate, timeZone)
    };
  }, [meta.data?.min_timestamp_utc, meta.data?.max_timestamp_utc, timeZone]);

  useEffect(() => {
    const next = buildParamsWithDefaults(
      new URLSearchParams(searchParams.toString()),
      defaults
    );
    if (rangeParam === "all") {
      const { from, to } = resolveAllTimeRange();
      if (parseIsoToMs(next.get("from")) === null) next.set("from", from);
      if (parseIsoToMs(next.get("to")) === null) next.set("to", to);
      next.set("range", "all");
    }
    if (next.toString() !== searchParams.toString()) {
      router.replace(asRoute(`${pathname}?${next.toString()}`), { scroll: false });
    }
  }, [
    searchParams,
    defaults,
    router,
    pathname,
    rangeParam,
    resolveAllTimeRange
  ]);

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString()), defaults),
    [searchParams, defaults]
  );
  const options = useEndpoint<FilterOptions>("/api/filters/options", filters, {
    ttl: 60_000
  });

  const inferredPreset = useMemo(
    () => inferPreset(filters.from, filters.to),
    [filters.from, filters.to]
  );
  const [customSelected, setCustomSelected] = useState(false);
  const rangePreset = customSelected
    ? "custom"
    : rangeParam === "all"
      ? "all"
      : inferredPreset;
  const [fromInput, setFromInput] = useState(
    formatDateTimeInput(filters.from, timeZone)
  );
  const [toInput, setToInput] = useState(
    formatDateTimeInput(filters.to, timeZone)
  );
  const [topNInput, setTopNInput] = useState(String(filters.topN));

  useEffect(() => {
    setFromInput(formatDateTimeInput(filters.from, timeZone));
    setToInput(formatDateTimeInput(filters.to, timeZone));
    setTopNInput(String(filters.topN));
  }, [filters.from, filters.to, filters.topN, timeZone]);

  const debouncedTopN = useDebouncedValue(topNInput, 250);

  const replaceParams = useCallback(
    (nextParams: URLSearchParams) => {
      if (nextParams.toString() !== searchParams.toString()) {
        router.replace(asRoute(`${pathname}?${nextParams.toString()}`), {
          scroll: false
        });
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
    const numeric = Number(debouncedTopN);
    updateParams({ topN: numeric > 0 ? numeric : DEFAULT_TOP_N });
  }, [debouncedTopN, updateParams]);

  const handlePresetChange = (value: string) => {
    if (value === "custom") {
      setCustomSelected(true);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("range");
      replaceParams(params);
      return;
    }
    setCustomSelected(false);

    if (value === "all") {
      const { from, to } = resolveAllTimeRange();
      const params = new URLSearchParams(searchParams.toString());
      params.set("range", "all");
      params.set("from", from);
      params.set("to", to);
      replaceParams(params);
      return;
    }

    const now = new Date();
    const preset = RANGE_PRESETS.find((entry) => entry.value === value);
    if (!preset?.hours) return;
    const from = new Date(now.getTime() - preset.hours * 60 * 60 * 1000);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
    params.set("from", toZonedIso(from, timeZone));
    params.set("to", toZonedIso(now, timeZone));
    replaceParams(params);
  };

  const handleCustomChange = (type: "from" | "to", value: string) => {
    const iso = parseDateTimeInput(value, timeZone);
    if (!iso) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
    params.set(type, iso);
    replaceParams(params);
  };

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
        <TagInput
          value={filters.models}
          onChange={(next) => updateParams({ models: next })}
          options={options.data?.models ?? []}
          placeholder="gpt-5.2-codex, gpt-5.1"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="dirs">Directories</Label>
        <TagInput
          value={filters.dirs}
          onChange={(next) => updateParams({ dirs: next })}
          options={options.data?.directories ?? []}
          placeholder="/apps, /services"
        />
      </div>

      {hasMultipleSources ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="source">Source</Label>
          <TagInput
            value={filters.source}
            onChange={(next) => updateParams({ source: next })}
            options={options.data?.sources ?? []}
            placeholder="cli, app-server"
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

      {rangePreset === "custom" ? (
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
      ) : null}
    </div>
  );
};

export default GlobalFiltersBar;
