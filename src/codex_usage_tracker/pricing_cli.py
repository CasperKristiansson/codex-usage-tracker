from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .platform import default_config_path
from .report import (
    PricingConfig,
    PricingModel,
    _resolve_pricing_model_name,
    default_pricing,
    estimate_event_cost,
    load_pricing_config,
)
from .store import UsageStore


def load_config_payload(db_path: Optional[Path] = None) -> tuple[Path, dict[str, object]]:
    config_path = default_config_path(db_path)
    try:
        raw = config_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return config_path, {}
    except OSError:
        return config_path, {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return config_path, {}
    return config_path, payload if isinstance(payload, dict) else {}


def save_config_payload(config_path: Path, payload: dict[str, object]) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _pricing_payload(payload: dict[str, object]) -> dict[str, object]:
    pricing = payload.get("pricing")
    if isinstance(pricing, dict):
        return pricing
    pricing = {}
    payload["pricing"] = pricing
    return pricing


def _model_overrides(payload: dict[str, object]) -> dict[str, object]:
    pricing = _pricing_payload(payload)
    models = pricing.get("models")
    if isinstance(models, dict):
        return models
    models = {}
    pricing["models"] = models
    return models


def update_pricing_model(
    db_path: Optional[Path],
    model: str,
    *,
    input_rate: Optional[float],
    cached_input_rate: Optional[float],
    output_rate: Optional[float],
    per_unit: Optional[int] = None,
    unit: Optional[str] = None,
    currency_label: Optional[str] = None,
) -> dict[str, object]:
    config_path, payload = load_config_payload(db_path)
    pricing, _ = load_pricing_config(db_path)
    existing = pricing.models.get(model) or PricingModel(
        input_rate=0.0,
        cached_input_rate=0.0,
        output_rate=0.0,
    )
    updated = {
        "input_rate": float(input_rate if input_rate is not None else existing.input_rate),
        "cached_input_rate": float(
            cached_input_rate
            if cached_input_rate is not None
            else existing.cached_input_rate
        ),
        "output_rate": float(output_rate if output_rate is not None else existing.output_rate),
    }
    models = _model_overrides(payload)
    models[model] = updated
    pricing_payload = _pricing_payload(payload)
    if per_unit is not None:
        pricing_payload["per_unit"] = int(per_unit)
    if unit:
        pricing_payload["unit"] = unit
    if currency_label:
        payload["currency_label"] = currency_label
    save_config_payload(config_path, payload)
    return {
        "config_path": str(config_path),
        "model": model,
        "rates": updated,
    }


def remove_pricing_override(db_path: Optional[Path], model: str) -> dict[str, object]:
    config_path, payload = load_config_payload(db_path)
    removed = False
    pricing = payload.get("pricing")
    if isinstance(pricing, dict):
        models = pricing.get("models")
        if isinstance(models, dict) and model in models:
            del models[model]
            removed = True
            if not models:
                pricing.pop("models", None)
        if not pricing:
            payload.pop("pricing", None)
    save_config_payload(config_path, payload)
    return {
        "config_path": str(config_path),
        "model": model,
        "removed": removed,
    }


def _usage_by_model(
    store: UsageStore,
    start: Optional[str],
    end: Optional[str],
    pricing: PricingConfig,
) -> dict[str, dict[str, object]]:
    clauses = ["event_type IN ('usage_line', 'token_count')"]
    params: list[str] = []
    if start:
        clauses.append("captured_at_utc >= ?")
        params.append(start)
    if end:
        clauses.append("captured_at_utc <= ?")
        params.append(end)
    rows = store.conn.execute(
        f"""
        SELECT COALESCE(model, '(unknown)') AS model,
               COUNT(*) AS usage_events,
               SUM(total_tokens) AS total_tokens,
               SUM(input_tokens) AS input_tokens,
               SUM(cached_input_tokens) AS cached_input_tokens,
               SUM(output_tokens) AS output_tokens
        FROM events
        WHERE {" AND ".join(clauses)}
        GROUP BY COALESCE(model, '(unknown)')
        """,
        params,
    ).fetchall()
    usage = {}
    for row in rows:
        model = str(row["model"])
        estimated_cost = estimate_event_cost(
            {
                "model": model,
                "input_tokens": int(row["input_tokens"] or 0),
                "cached_input_tokens": int(row["cached_input_tokens"] or 0),
                "output_tokens": int(row["output_tokens"] or 0),
            },
            pricing,
        )
        usage[model] = {
            "usage_events": int(row["usage_events"] or 0),
            "total_tokens": int(row["total_tokens"] or 0),
            "estimated_cost": estimated_cost,
        }
    return usage


def pricing_status(
    store: UsageStore,
    db_path: Optional[Path],
    start: Optional[str],
    end: Optional[str],
    *,
    used_only: bool = False,
) -> dict[str, object]:
    config_path, payload = load_config_payload(db_path)
    pricing, currency_label = load_pricing_config(db_path)
    defaults = default_pricing()
    override_models = {}
    pricing_payload = payload.get("pricing")
    if isinstance(pricing_payload, dict) and isinstance(pricing_payload.get("models"), dict):
        override_models = pricing_payload["models"]
    elif isinstance(payload.get("models"), dict):
        override_models = payload["models"]
    usage = _usage_by_model(store, start, end, pricing)

    names = set(pricing.models) | set(usage)
    if used_only:
        names = set(usage)
    rows = []
    for model in sorted(names):
        pricing_model = _resolve_pricing_model_name(model, pricing)
        rates = pricing.models.get(pricing_model) if pricing_model else None
        usage_row = usage.get(model, {})
        source = "override" if model in override_models else "default"
        if pricing_model and pricing_model != model:
            source = f"alias:{pricing_model}"
        if model not in defaults.models and model in pricing.models and model not in override_models:
            source = "custom"
        rows.append(
            {
                "model": model,
                "pricing_model": pricing_model,
                "source": source if rates is not None else "unpriced",
                "input_rate": rates.input_rate if rates is not None else None,
                "cached_input_rate": rates.cached_input_rate if rates is not None else None,
                "output_rate": rates.output_rate if rates is not None else None,
                "usage_events": int(usage_row.get("usage_events") or 0),
                "total_tokens": int(usage_row.get("total_tokens") or 0),
                "estimated_cost": usage_row.get("estimated_cost"),
            }
        )
    return {
        "config_path": str(config_path),
        "currency_label": currency_label,
        "unit": pricing.unit,
        "per_unit": pricing.per_unit,
        "models": rows,
    }
