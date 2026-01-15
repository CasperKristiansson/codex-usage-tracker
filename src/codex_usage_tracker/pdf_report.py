from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from .report import STOCKHOLM_TZ, parse_datetime


@dataclass
class PricingModel:
    input_rate: float
    output_rate: float
    cached_input_rate: float


@dataclass
class PricingConfig:
    unit: str
    per_unit: int
    models: Dict[str, PricingModel]


def default_pricing() -> PricingConfig:
    per_unit = 1_000_000
    return PricingConfig(
        unit="per_1m",
        per_unit=per_unit,
        models={
            "gpt-5.2": PricingModel(
                input_rate=1.750,
                cached_input_rate=0.175,
                output_rate=14.000,
            ),
            "gpt-5.1-codex-max": PricingModel(
                input_rate=1.25,
                cached_input_rate=0.125,
                output_rate=10.00,
            ),
            "gpt-5.1-codex": PricingModel(
                input_rate=1.25,
                cached_input_rate=0.125,
                output_rate=10.00,
            ),
            "gpt-5.2-codex": PricingModel(
                input_rate=1.75,
                cached_input_rate=0.175,
                output_rate=14.00,
            ),
        },
    )


def _sum_event_fields(events: Iterable[Dict[str, object]]) -> Dict[str, int]:
    totals = {
        "total_tokens": 0,
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "output_tokens": 0,
        "reasoning_output_tokens": 0,
    }
    for event in events:
        totals["total_tokens"] += int(event.get("total_tokens") or 0)
        totals["input_tokens"] += int(event.get("input_tokens") or 0)
        totals["cached_input_tokens"] += int(event.get("cached_input_tokens") or 0)
        totals["output_tokens"] += int(event.get("output_tokens") or 0)
        totals["reasoning_output_tokens"] += int(event.get("reasoning_output_tokens") or 0)
    return totals


def _group_totals(events: Iterable[Dict[str, object]], key: str) -> Dict[str, Dict[str, int]]:
    groups: Dict[str, Dict[str, int]] = {}
    for event in events:
        label = event.get(key) or "<unknown>"
        if label not in groups:
            groups[label] = {
                "total_tokens": 0,
                "input_tokens": 0,
                "cached_input_tokens": 0,
                "output_tokens": 0,
                "reasoning_output_tokens": 0,
            }
        groups[label]["total_tokens"] += int(event.get("total_tokens") or 0)
        groups[label]["input_tokens"] += int(event.get("input_tokens") or 0)
        groups[label]["cached_input_tokens"] += int(event.get("cached_input_tokens") or 0)
        groups[label]["output_tokens"] += int(event.get("output_tokens") or 0)
        groups[label]["reasoning_output_tokens"] += int(
            event.get("reasoning_output_tokens") or 0
        )
    return groups


def _daily_series(
    events: Iterable[Dict[str, object]],
    start: Optional[datetime],
    end: Optional[datetime],
) -> Tuple[List[datetime], List[int]]:
    totals: Dict[str, int] = {}
    for event in events:
        dt = parse_datetime(event["captured_at"]).astimezone(STOCKHOLM_TZ)
        day = dt.date().isoformat()
        totals[day] = totals.get(day, 0) + int(event.get("total_tokens") or 0)

    if not totals:
        return [], []

    if start is None:
        start = min(parse_datetime(d + "T00:00:00") for d in totals.keys())
    if end is None:
        end = max(parse_datetime(d + "T00:00:00") for d in totals.keys())

    start = start.astimezone(STOCKHOLM_TZ)
    end = end.astimezone(STOCKHOLM_TZ)
    days = []
    values = []
    cursor = datetime(start.year, start.month, start.day, tzinfo=STOCKHOLM_TZ)
    end_day = datetime(end.year, end.month, end.day, tzinfo=STOCKHOLM_TZ)
    while cursor <= end_day:
        key = cursor.date().isoformat()
        days.append(cursor)
        values.append(totals.get(key, 0))
        cursor += timedelta(days=1)
    return days, values


def _compute_costs(
    events: Iterable[Dict[str, object]],
    pricing: PricingConfig,
) -> Tuple[float, int, int, Dict[str, float]]:
    total_cost = 0.0
    covered_events = 0
    total_events = 0
    per_model: Dict[str, float] = {}
    for event in events:
        total_events += 1
        model = event.get("model")
        if not model or model not in pricing.models:
            continue
        rates = pricing.models[model]
        input_tokens = int(event.get("input_tokens") or 0)
        cached_tokens = int(event.get("cached_input_tokens") or 0)
        output_tokens = int(event.get("output_tokens") or 0)
        non_cached = max(input_tokens - cached_tokens, 0)
        cost = (
            (non_cached * rates.input_rate)
            + (cached_tokens * rates.cached_input_rate)
            + (output_tokens * rates.output_rate)
        ) / pricing.per_unit
        total_cost += cost
        covered_events += 1
        per_model[model] = per_model.get(model, 0.0) + cost
    return total_cost, covered_events, total_events, per_model


def generate_pdf_report(
    events: List[Dict[str, object]],
    latest_status: Optional[Dict[str, object]],
    out_path: Path,
    start: Optional[datetime],
    end: Optional[datetime],
    pricing: PricingConfig,
) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        from matplotlib import pyplot as plt
        from matplotlib.backends.backend_pdf import PdfPages
    except Exception as exc:
        raise RuntimeError(
            "PDF reporting requires matplotlib. Install with: pip install 'codex-usage-tracker[pdf]'"
        ) from exc

    totals = _sum_event_fields(events)
    per_model = _group_totals(events, "model")
    per_directory = _group_totals(events, "directory")
    days, daily_values = _daily_series(events, start, end)

    total_cost, covered, total_events, per_model_cost = _compute_costs(events, pricing)
    coverage = (covered / total_events * 100.0) if total_events else 0.0

    with PdfPages(out_path) as pdf:
        # Summary page
        fig = plt.figure(figsize=(8.27, 11.69))
        fig.suptitle("Codex Usage Report", fontsize=18, y=0.97)
        range_label = "All time"
        if start or end:
            start_label = start.astimezone(STOCKHOLM_TZ).strftime("%Y-%m-%d") if start else "?"
            end_label = end.astimezone(STOCKHOLM_TZ).strftime("%Y-%m-%d") if end else "?"
            range_label = f"{start_label} to {end_label}"
        fig.text(0.1, 0.92, f"Range: {range_label}")
        fig.text(0.1, 0.88, f"Total tokens: {totals['total_tokens']}")
        fig.text(0.1, 0.85, f"Input: {totals['input_tokens']}")
        fig.text(0.1, 0.82, f"Cached input: {totals['cached_input_tokens']}")
        fig.text(0.1, 0.79, f"Output: {totals['output_tokens']}")
        fig.text(0.1, 0.76, f"Reasoning: {totals['reasoning_output_tokens']}")

        fig.text(0.1, 0.72, f"Estimated cost: {total_cost:.2f}")
        fig.text(0.1, 0.69, f"Pricing coverage: {coverage:.0f}% of events")

        if latest_status:
            fig.text(
                0.1,
                0.64,
                f"Latest session: {latest_status.get('session_id') or '<unknown>'}",
            )
            fig.text(0.1, 0.61, f"Model: {latest_status.get('model') or '<unknown>'}")
            fig.text(
                0.1,
                0.58,
                f"Directory: {latest_status.get('directory') or '<unknown>'}",
            )
            if latest_status.get("context_total"):
                fig.text(
                    0.1,
                    0.55,
                    "Context: {percent}% left ({used} / {total})".format(
                        percent=latest_status.get("context_percent_left") or 0,
                        used=latest_status.get("context_used") or 0,
                        total=latest_status.get("context_total") or 0,
                    ),
                )
            if latest_status.get("limit_5h_percent_left") is not None:
                fig.text(
                    0.1,
                    0.52,
                    "5h limit: {percent}% left".format(
                        percent=latest_status.get("limit_5h_percent_left")
                    ),
                )
            if latest_status.get("limit_weekly_percent_left") is not None:
                fig.text(
                    0.1,
                    0.49,
                    "Weekly limit: {percent}% left".format(
                        percent=latest_status.get("limit_weekly_percent_left")
                    ),
                )

        pdf.savefig(fig)
        plt.close(fig)

        # Daily trend page
        fig = plt.figure(figsize=(8.27, 11.69))
        ax = fig.add_subplot(1, 1, 1)
        ax.set_title("Daily Token Usage")
        if days:
            ax.plot(days, daily_values, marker="o", linewidth=1.5)
            ax.set_ylabel("Tokens")
            ax.tick_params(axis="x", rotation=45)
        else:
            ax.text(0.5, 0.5, "No data", ha="center", va="center")
            ax.set_axis_off()
        fig.tight_layout(rect=[0, 0, 1, 0.97])
        pdf.savefig(fig)
        plt.close(fig)

        # Breakdown page
        fig, axes = plt.subplots(2, 1, figsize=(8.27, 11.69))
        fig.suptitle("Usage Breakdown", fontsize=16)

        model_items = sorted(per_model.items(), key=lambda item: item[1]["total_tokens"], reverse=True)
        model_items = model_items[:10]
        if model_items:
            labels = [item[0] for item in model_items]
            values = [item[1]["total_tokens"] for item in model_items]
            axes[0].barh(labels, values)
            axes[0].invert_yaxis()
            axes[0].set_title("Top Models by Tokens")
        else:
            axes[0].text(0.5, 0.5, "No model data", ha="center", va="center")
            axes[0].set_axis_off()

        dir_items = sorted(
            per_directory.items(), key=lambda item: item[1]["total_tokens"], reverse=True
        )
        dir_items = dir_items[:10]
        if dir_items:
            labels = [item[0] for item in dir_items]
            values = [item[1]["total_tokens"] for item in dir_items]
            axes[1].barh(labels, values)
            axes[1].invert_yaxis()
            axes[1].set_title("Top Projects by Tokens")
        else:
            axes[1].text(0.5, 0.5, "No directory data", ha="center", va="center")
            axes[1].set_axis_off()

        fig.tight_layout(rect=[0, 0, 1, 0.96])
        pdf.savefig(fig)
        plt.close(fig)

        # Cost breakdown page (optional)
        fig = plt.figure(figsize=(8.27, 11.69))
        ax = fig.add_subplot(1, 1, 1)
        ax.set_title("Estimated Cost by Model")
        items = sorted(per_model_cost.items(), key=lambda item: item[1], reverse=True)
        labels = [item[0] for item in items[:10]]
        values = [item[1] for item in items[:10]]
        if labels:
            ax.barh(labels, values)
            ax.invert_yaxis()
            ax.set_xlabel("Cost")
        else:
            ax.text(0.5, 0.5, "No priced models", ha="center", va="center")
            ax.set_axis_off()
        fig.tight_layout(rect=[0, 0, 1, 0.97])
        pdf.savefig(fig)
        plt.close(fig)
