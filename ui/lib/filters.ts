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
export const DEFAULT_RANGE_DAYS = 14;

const splitCsv = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const joinCsv = (value: string[]) => value.join(",");

export const getDefaultFilters = () => {
  const now = new Date();
  const to = now.toISOString();
  const from = new Date(
    now.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

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
  return {
    from: params.get("from") || defaults.from,
    to: params.get("to") || defaults.to,
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
  if (!next.get("from")) next.set("from", defaults.from);
  if (!next.get("to")) next.set("to", defaults.to);
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
