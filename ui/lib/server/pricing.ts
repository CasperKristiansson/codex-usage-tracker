import fs from "fs";
import path from "path";

import {
  DEFAULT_CURRENCY_LABEL,
  DEFAULT_PRICING,
  type PricingConfig,
  type PricingModel,
  type PricingSettings
} from "@/lib/pricing";
import { resolveConfigPath } from "@/lib/server/paths";

type PricingOverrides = {
  unit?: PricingConfig["unit"];
  per_unit?: number;
  models?: Record<string, Partial<PricingModel>>;
};

type RawPricingPayload = {
  pricing?: PricingOverrides;
  models?: PricingOverrides["models"];
  unit?: PricingOverrides["unit"];
  per_unit?: number;
  currency_label?: string;
  currencyLabel?: string;
  currency?: string;
};

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeLabel = (value: unknown) => {
  if (typeof value !== "string") return DEFAULT_CURRENCY_LABEL;
  const trimmed = value.trim();
  return trimmed || DEFAULT_CURRENCY_LABEL;
};

const mergePricing = (overrides?: PricingOverrides): PricingConfig => {
  const baseModels = { ...DEFAULT_PRICING.models };
  if (overrides?.models && typeof overrides.models === "object") {
    Object.entries(overrides.models).forEach(([model, rates]) => {
      if (!rates) return;
      const base = baseModels[model] ?? {
        input_rate: 0,
        cached_input_rate: 0,
        output_rate: 0
      };
      const input = coerceNumber(rates.input_rate);
      const cached = coerceNumber(rates.cached_input_rate);
      const output = coerceNumber(rates.output_rate);
      if (input === null && cached === null && output === null && !baseModels[model]) {
        return;
      }
      baseModels[model] = {
        input_rate: input ?? base.input_rate,
        cached_input_rate: cached ?? base.cached_input_rate,
        output_rate: output ?? base.output_rate
      };
    });
  }

  const perUnit = coerceNumber(overrides?.per_unit);
  const unit =
    typeof overrides?.unit === "string" && overrides.unit
      ? overrides.unit
      : DEFAULT_PRICING.unit;

  return {
    unit,
    per_unit: perUnit && perUnit > 0 ? perUnit : DEFAULT_PRICING.per_unit,
    models: baseModels
  };
};

const readPricingPayload = (configPath: string): RawPricingPayload => {
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const payload = JSON.parse(raw);
    return typeof payload === "object" && payload !== null ? (payload as RawPricingPayload) : {};
  } catch {
    return {};
  }
};

const buildOverrides = (pricing: PricingConfig): PricingOverrides | null => {
  const overrides: PricingOverrides = {};
  if (pricing.per_unit !== DEFAULT_PRICING.per_unit) {
    overrides.per_unit = pricing.per_unit;
  }
  if (pricing.unit !== DEFAULT_PRICING.unit) {
    overrides.unit = pricing.unit;
  }

  const modelOverrides: Record<string, PricingModel> = {};
  Object.entries(pricing.models).forEach(([model, rates]) => {
    const base = DEFAULT_PRICING.models[model];
    if (!base) {
      modelOverrides[model] = rates;
      return;
    }
    if (
      rates.input_rate !== base.input_rate ||
      rates.cached_input_rate !== base.cached_input_rate ||
      rates.output_rate !== base.output_rate
    ) {
      modelOverrides[model] = rates;
    }
  });

  if (Object.keys(modelOverrides).length) {
    overrides.models = modelOverrides;
  }

  if (!overrides.models && overrides.per_unit === undefined && overrides.unit === undefined) {
    return null;
  }
  return overrides;
};

const resolveDbOverride = (
  value?: URLSearchParams | string | null
): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.get("db");
};

export const loadPricingSettings = (
  dbOverride?: URLSearchParams | string | null
): PricingSettings => {
  const configPath = resolveConfigPath(resolveDbOverride(dbOverride));
  const payload = readPricingPayload(configPath);
  const label =
    payload.currency_label ??
    payload.currencyLabel ??
    payload.currency ??
    DEFAULT_CURRENCY_LABEL;
  const pricingSource = payload.pricing ?? payload;
  const pricing = mergePricing({
    unit: pricingSource.unit,
    per_unit: pricingSource.per_unit,
    models: pricingSource.models
  });

  return {
    currency_label: normalizeLabel(label),
    pricing
  };
};

export const savePricingSettings = (
  input: PricingSettings,
  dbOverride?: URLSearchParams | string | null
) => {
  const configPath = resolveConfigPath(resolveDbOverride(dbOverride));
  const currency_label = normalizeLabel(input.currency_label);
  const pricing = mergePricing({
    unit: input.pricing.unit,
    per_unit: input.pricing.per_unit,
    models: input.pricing.models
  });
  const overrides = buildOverrides(pricing);
  const payload: Record<string, unknown> = {};

  if (currency_label !== DEFAULT_CURRENCY_LABEL) {
    payload.currency_label = currency_label;
  }
  if (overrides) {
    payload.pricing = overrides;
  }

  if (!Object.keys(payload).length) {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    return { currency_label, pricing };
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2));
  return { currency_label, pricing };
};
