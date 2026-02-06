export type PricingModel = {
  input_rate: number;
  cached_input_rate: number;
  output_rate: number;
};

export type PricingConfig = {
  unit: "per_1m";
  per_unit: number;
  models: Record<string, PricingModel>;
};

export type PricingSettings = {
  currency_label: string;
  pricing: PricingConfig;
};

export const DEFAULT_CURRENCY_LABEL = "$";

export const DEFAULT_PRICING: PricingConfig = {
  unit: "per_1m",
  per_unit: 1_000_000,
  models: {
    "gpt-5.2": {
      input_rate: 1.75,
      cached_input_rate: 0.175,
      output_rate: 14.0
    },
    // Some rollups/events may report a major-only "gpt-5" model name.
    // Treat as equivalent to gpt-5.2 unless overridden.
    "gpt-5": {
      input_rate: 1.75,
      cached_input_rate: 0.175,
      output_rate: 14.0
    },
    "gpt-5.1-codex-max": {
      input_rate: 1.25,
      cached_input_rate: 0.125,
      output_rate: 10.0
    },
    "gpt-5.1-codex": {
      input_rate: 1.25,
      cached_input_rate: 0.125,
      output_rate: 10.0
    },
    "gpt-5.2-codex": {
      input_rate: 1.75,
      cached_input_rate: 0.175,
      output_rate: 14.0
    },
    // Some environments may report these names even if they are not
    // directly available via the public API. We map them to gpt-5.2-codex
    // by default to keep cost coverage high.
    "gpt-5-codex": {
      input_rate: 1.75,
      cached_input_rate: 0.175,
      output_rate: 14.0
    },
    "gpt-5.3-codex": {
      input_rate: 1.75,
      cached_input_rate: 0.175,
      output_rate: 14.0
    }
  }
};

const MODEL_ALIASES: Record<string, string> = {
  "gpt-5.3-codex": "gpt-5.2-codex",
  "gpt-5-codex": "gpt-5.2-codex",
  "gpt-5": "gpt-5.2"
};

const resolvePricingModelName = (model: string, pricing: PricingConfig) => {
  if (pricing.models[model]) return model;
  const cleaned = model.trim();
  if (pricing.models[cleaned]) return cleaned;

  // Strip common status decorations like "gpt-5.2-codex (fast)".
  if (cleaned.includes(" (") && cleaned.endsWith(")")) {
    const base = cleaned.split(" (")[0].trim();
    if (pricing.models[base]) return base;
  }

  // Strip dated suffixes like "gpt-5.2-codex-2026-01-15".
  const undated = cleaned.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (undated !== cleaned && pricing.models[undated]) return undated;

  const alias = MODEL_ALIASES[cleaned];
  if (alias && pricing.models[alias]) return alias;

  return null;
};

export type PricingRow = {
  model?: string | null;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
};

export const estimateCost = (
  row: PricingRow,
  pricing: PricingConfig = DEFAULT_PRICING
) => {
  const model = resolvePricingModelName(row.model ?? "", pricing);
  if (!model) return null;
  const rates = pricing.models[model];
  if (!rates) return null;
  const inputTokens = Number(row.input_tokens ?? 0);
  const cachedTokens = Number(row.cached_input_tokens ?? 0);
  const outputTokens = Number(row.output_tokens ?? 0);
  const nonCached = Math.max(inputTokens - cachedTokens, 0);
  return (
    nonCached * rates.input_rate +
    cachedTokens * rates.cached_input_rate +
    outputTokens * rates.output_rate
  ) / pricing.per_unit;
};
