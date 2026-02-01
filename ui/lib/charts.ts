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

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric"
});
const hourFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric"
});

export const formatBucketLabel = (
  bucket: string,
  bucketType: "hour" | "day"
) => {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  return bucketType === "hour"
    ? hourFormatter.format(date)
    : dayFormatter.format(date);
};

export const formatBucketValue = (
  bucket: string,
  bucketType: "hour" | "day"
) => {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  return bucketType === "hour"
    ? date.toLocaleTimeString("en-US", { hour: "numeric" })
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
      });
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
