import { DEFAULT_RANGE_DAYS, MAX_TOP_N, MIN_TOP_N } from "@/lib/server/constants";

export type BucketOption = "auto" | "hour" | "day";

export type NormalizedFilters = {
  from: string;
  to: string;
  bucket: BucketOption;
  resolvedBucket: Exclude<BucketOption, "auto">;
  models: string[];
  dirs: string[];
  source: string[];
  topN: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const parseList = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseIso = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return trimmed;
};

export const parseFilters = (searchParams: URLSearchParams): NormalizedFilters => {
  const now = new Date();
  const defaultTo = now.toISOString();
  const defaultFrom = new Date(
    now.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  let from = parseIso(searchParams.get("from")) ?? defaultFrom;
  let to = parseIso(searchParams.get("to")) ?? defaultTo;

  if (new Date(from).getTime() > new Date(to).getTime()) {
    [from, to] = [to, from];
  }

  const bucketRaw = searchParams.get("bucket");
  const bucket: BucketOption =
    bucketRaw === "hour" || bucketRaw === "day" || bucketRaw === "auto"
      ? bucketRaw
      : "auto";
  const topNRaw = Number(searchParams.get("topN"));
  const topN = clamp(
    Number.isNaN(topNRaw) || topNRaw <= 0 ? 10 : topNRaw,
    MIN_TOP_N,
    MAX_TOP_N
  );

  const rangeHours = Math.max(
    0,
    (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60)
  );
  const resolvedBucket: NormalizedFilters["resolvedBucket"] =
    bucket === "auto" ? (rangeHours <= 72 ? "hour" : "day") : bucket;

  return {
    from,
    to,
    bucket,
    resolvedBucket,
    models: parseList(searchParams.get("models")),
    dirs: parseList(searchParams.get("dirs")),
    source: parseList(searchParams.get("source")),
    topN
  };
};

export const getRangeHours = (filters: NormalizedFilters) => {
  return Math.max(
    0,
    (new Date(filters.to).getTime() - new Date(filters.from).getTime()) /
      (1000 * 60 * 60)
  );
};
