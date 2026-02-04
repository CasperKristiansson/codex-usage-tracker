import { normalizeTimeZone, parseDateTimeInput } from "@/lib/timezone";

export const TOKEN_MIX_COLORS = {
  input_tokens: "#60A5FA",
  cached_input_tokens: "#34D399",
  output_tokens: "#A78BFA",
  reasoning_tokens: "#FBBF24"
};

export const SERIES_COLORS = [
  "#60A5FA",
  "#A78BFA",
  "#34D399",
  "#FBBF24",
  "#F87171",
  "#22D3EE",
  "#F472B6",
  "#FB7185",
  "#C084FC",
  "#93C5FD"
];

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions
) => {
  const key = `${timeZone ?? "local"}:${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    ...options,
    ...(timeZone ? { timeZone } : {})
  });
  formatterCache.set(key, formatter);
  return formatter;
};

const resolveBucketDate = (bucket: string, timeZone?: string) => {
  const hasOffset = /(?:Z|[+-]\\d{2}:\\d{2})$/.test(bucket);
  if (hasOffset || !timeZone) return new Date(bucket);
  const tz = normalizeTimeZone(timeZone);
  let normalized = bucket;
  if (bucket.length === 10) {
    normalized = `${bucket}T00:00`;
  } else if (bucket.length === 13) {
    normalized = `${bucket}:00`;
  } else if (bucket.length >= 16) {
    normalized = bucket.slice(0, 16);
  }
  const iso = parseDateTimeInput(normalized, tz);
  return iso ? new Date(iso) : new Date(bucket);
};

export const formatBucketLabel = (
  bucket: string,
  bucketType: "hour" | "day",
  timeZone?: string
) => {
  const date = resolveBucketDate(bucket, timeZone);
  if (Number.isNaN(date.getTime())) return bucket;
  const formatter =
    bucketType === "hour"
      ? getFormatter(timeZone, { month: "short", day: "numeric", hour: "numeric" })
      : getFormatter(timeZone, { month: "short", day: "numeric" });
  return formatter.format(date);
};

export const formatBucketValue = (
  bucket: string,
  bucketType: "hour" | "day",
  timeZone?: string
) => {
  const date = resolveBucketDate(bucket, timeZone);
  if (Number.isNaN(date.getTime())) return bucket;
  const formatter =
    bucketType === "hour"
      ? getFormatter(timeZone, { hour: "numeric" })
      : getFormatter(timeZone, { month: "short", day: "numeric" });
  return formatter.format(date);
};

export const safeNumber = (value: unknown) => {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

export const uniqueBuckets = (series: Array<{ bucket: string }>) => {
  return Array.from(new Set(series.map((item) => item.bucket))).sort();
};
