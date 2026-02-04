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
    }
  }
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
  const model = row.model ?? "";
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
