export const formatCompactNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
};

export const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const normalized = value > 1 ? value / 100 : value;
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(normalized);
};

export const formatDuration = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const ms = Number(value);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
};

export const formatCurrency = (
  value: number | null | undefined,
  compact = false,
  currencyLabel = "$"
) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const formatted = new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
    notation: compact ? "compact" : "standard"
  }).format(value);
  const label = currencyLabel?.trim();
  if (!label) return formatted;
  if (label.length === 1) return `${label}${formatted}`;
  if (label.endsWith(" ")) return `${label}${formatted}`;
  return `${label} ${formatted}`;
};

export const formatBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Math.max(0, value);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
};
