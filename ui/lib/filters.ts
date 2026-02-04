import { normalizeTimeZone, toZonedIso } from "@/lib/timezone";

export type BucketOption = "auto" | "hour" | "day";

export type Filters = {
  from: string;
  to: string;
  bucket: BucketOption;
  models: string[];
  dirs: string[];
  source: string[];
  topN: number;
};

export const DEFAULT_TOP_N = 10;
export const DEFAULT_BUCKET: BucketOption = "auto";
export const DEFAULT_RANGE_DAYS = 30;

const isValidDateValue = (value: string | null) => {
  if (!value) return false;
  const ts = Date.parse(value);
  return Number.isFinite(ts);
};

const splitCsv = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const joinCsv = (value: string[]) => value.join(",");

export const getDefaultFilters = (timezone?: string) => {
  const tz = normalizeTimeZone(timezone);
  const now = new Date();
  const to = toZonedIso(now, tz);
  const from = toZonedIso(
    new Date(now.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000),
    tz
  );

  return {
    from,
    to,
    bucket: DEFAULT_BUCKET,
    models: [],
    dirs: [],
    source: [],
    topN: DEFAULT_TOP_N
  } satisfies Filters;
};

export const parseFilters = (
  params: URLSearchParams,
  defaults: Filters
): Filters => {
  const fromParam = params.get("from");
  const toParam = params.get("to");
  return {
    from: isValidDateValue(fromParam) ? fromParam! : defaults.from,
    to: isValidDateValue(toParam) ? toParam! : defaults.to,
    bucket: (params.get("bucket") as BucketOption) || defaults.bucket,
    models: splitCsv(params.get("models")),
    dirs: splitCsv(params.get("dirs")),
    source: splitCsv(params.get("source")),
    topN: Number(params.get("topN")) || defaults.topN
  };
};

export const buildParamsWithDefaults = (
  params: URLSearchParams,
  defaults: Filters
) => {
  const next = new URLSearchParams(params);
  if (!isValidDateValue(next.get("from"))) next.set("from", defaults.from);
  if (!isValidDateValue(next.get("to"))) next.set("to", defaults.to);
  if (!next.get("bucket")) next.set("bucket", defaults.bucket);
  if (!next.get("topN")) next.set("topN", String(defaults.topN));
  return next;
};

export const setFilterParam = (
  params: URLSearchParams,
  key: keyof Filters,
  value: string | number | string[]
) => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      params.delete(key);
    } else {
      params.set(key, joinCsv(value));
    }
    return params;
  }

  if (value === "") {
    params.delete(key);
  } else {
    params.set(key, String(value));
  }
  return params;
};

export const areFiltersDefault = (filters: Filters, defaults: Filters) => {
  return (
    filters.from === defaults.from &&
    filters.to === defaults.to &&
    filters.bucket === defaults.bucket &&
    filters.topN === defaults.topN &&
    filters.models.length === 0 &&
    filters.dirs.length === 0 &&
    filters.source.length === 0
  );
};
