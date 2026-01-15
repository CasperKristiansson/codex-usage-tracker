from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import altair as alt
import pandas as pd
import streamlit as st

try:
    from .cli import ingest_rollouts
    from .platform import default_db_path, default_rollouts_dir
    from .report import STOCKHOLM_TZ, aggregate, parse_datetime, parse_last, to_local
    from .store import UsageStore
except ImportError:
    # Allow running via `streamlit run` with a direct file path.
    import sys as _sys

    _sys.path.append(str(Path(__file__).resolve().parents[1]))
    from codex_usage_tracker.cli import ingest_rollouts
    from codex_usage_tracker.platform import default_db_path, default_rollouts_dir
    from codex_usage_tracker.report import (
        STOCKHOLM_TZ,
        aggregate,
        parse_datetime,
        parse_last,
        to_local,
    )
    from codex_usage_tracker.store import UsageStore


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


TOKEN_FIELDS = [
    "total_tokens",
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
]


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


def _format_compact(value: float) -> str:
    abs_value = abs(value)
    if abs_value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.2f}B"
    if abs_value >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    if abs_value >= 1_000:
        return f"{value / 1_000:.1f}K"
    return f"{value:.0f}"


def _format_currency(value: float) -> str:
    return f"${value:,.2f}"


def _shorten_directory(value: str) -> str:
    if not value or value == "<unknown>":
        return "<unknown>"
    name = Path(value).name
    return name or value


def _select_range_defaults() -> Tuple[Optional[datetime], Optional[datetime]]:
    env_last = os.getenv("CODEX_USAGE_LAST")
    env_from = os.getenv("CODEX_USAGE_FROM")
    env_to = os.getenv("CODEX_USAGE_TO")
    now = datetime.now(STOCKHOLM_TZ)
    if env_last:
        try:
            delta = parse_last(env_last)
        except ValueError:
            return None, None
        return now - delta, now
    if env_from or env_to:
        start = to_local(parse_datetime(env_from)) if env_from else None
        end = to_local(parse_datetime(env_to)) if env_to else None
        return start, end
    return None, None


def _range_label(start: Optional[datetime], end: Optional[datetime]) -> str:
    if not start and not end:
        return "All time"
    if start and end:
        return "{start} to {end}".format(
            start=start.astimezone(STOCKHOLM_TZ).strftime("%Y-%m-%d"),
            end=end.astimezone(STOCKHOLM_TZ).strftime("%Y-%m-%d"),
        )
    if start:
        return "From {start}".format(
            start=start.astimezone(STOCKHOLM_TZ).strftime("%Y-%m-%d")
        )
    return "Up to {end}".format(end=end.astimezone(STOCKHOLM_TZ).strftime("%Y-%m-%d"))


def _enrich_events(events: Iterable[Dict[str, object]]) -> List[Dict[str, object]]:
    enriched = []
    for event in events:
        captured_at = parse_datetime(event["captured_at"])
        local_dt = to_local(captured_at)
        row = dict(event)
        row["captured_local"] = local_dt
        row["date"] = local_dt.date()
        row["weekday"] = local_dt.strftime("%a")
        row["hour"] = local_dt.hour
        row["model"] = event.get("model") or "<unknown>"
        row["directory"] = event.get("directory") or "<unknown>"
        row["directory_label"] = _shorten_directory(row["directory"])
        row["session_id"] = event.get("session_id") or "<unknown>"
        enriched.append(row)
    return enriched


@st.cache_data(show_spinner=False)
def _load_events(db_path: str) -> List[Dict[str, object]]:
    store = UsageStore(Path(db_path))
    rows = store.iter_events()
    events = [dict(row) for row in rows]
    store.close()
    return [
        event
        for event in events
        if event.get("event_type") in ("usage_line", "token_count")
    ]


@st.cache_data(show_spinner=False)
def _load_latest_status(db_path: str) -> Optional[Dict[str, object]]:
    store = UsageStore(Path(db_path))
    row = store.latest_status()
    store.close()
    return dict(row) if row else None


def _sync_rollouts(
    db_path: str,
    rollouts_path: str,
    start: Optional[datetime],
    end: Optional[datetime],
) -> Tuple[int, int]:
    store = UsageStore(Path(db_path))
    stats = ingest_rollouts(Path(rollouts_path), store, start, end)
    store.close()
    return stats.files_parsed, stats.events


def _altair_theme() -> Dict[str, object]:
    return {
        "config": {
            "background": "transparent",
            "axis": {
                "labelColor": "#5b6472",
                "titleColor": "#5b6472",
                "gridColor": "rgba(15, 23, 42, 0.08)",
                "tickColor": "rgba(15, 23, 42, 0.08)",
            },
            "legend": {
                "labelColor": "#5b6472",
                "titleColor": "#5b6472",
            },
            "view": {"stroke": "transparent"},
        }
    }


def _inject_css() -> None:
    st.markdown(
        """
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

        :root {
            --bg: #f6f3ee;
            --panel: #ffffff;
            --panel-alt: #f4f7fb;
            --ink: #111827;
            --muted: #5b6472;
            --accent: #0f766e;
            --accent-2: #f97316;
            --accent-3: #2563eb;
            --border: rgba(15, 23, 42, 0.08);
            --shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
        }

        @keyframes fadeUp {
            from {
                opacity: 0;
                transform: translateY(12px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        html, body, [data-testid="stAppViewContainer"] {
            background: var(--bg);
            color: var(--ink);
            font-family: 'IBM Plex Sans', sans-serif;
        }

        [data-testid="stSidebar"] {
            background: #fcfaf7;
            border-right: 1px solid var(--border);
        }

        h1, h2, h3, h4, h5 {
            font-family: 'Space Grotesk', sans-serif;
            letter-spacing: -0.02em;
        }

        .hero {
            padding: 2.5rem 2.4rem 1.8rem;
            background: linear-gradient(140deg, rgba(15, 118, 110, 0.16), rgba(249, 115, 22, 0.08));
            border: 1px solid var(--border);
            border-radius: 26px;
            box-shadow: var(--shadow);
            position: relative;
            overflow: hidden;
            animation: fadeUp 0.6s ease both;
        }

        .hero-title {
            font-size: 2.6rem;
            font-weight: 700;
            margin-bottom: 0.35rem;
        }

        .hero-subtitle {
            margin-top: 0.6rem;
            font-size: 1.05rem;
            color: var(--muted);
        }

        .hero-meta {
            margin-top: 1.3rem;
            display: flex;
            flex-wrap: wrap;
            gap: 0.6rem;
        }

        .hero-pill {
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid var(--border);
            padding: 0.35rem 0.75rem;
            border-radius: 999px;
            font-size: 0.85rem;
            color: var(--muted);
        }

        .kpi-card {
            padding: 1.2rem 1.3rem;
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 20px;
            box-shadow: var(--shadow);
            min-height: 120px;
            animation: fadeUp 0.6s ease both;
            animation-delay: var(--delay, 0ms);
        }

        .kpi-label {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: var(--muted);
        }

        .kpi-value {
            font-size: 1.8rem;
            font-weight: 600;
            margin-top: 0.45rem;
        }

        .kpi-sub {
            margin-top: 0.4rem;
            font-size: 0.85rem;
            color: var(--muted);
        }

        .section-title {
            margin: 1.6rem 0 0.7rem;
            font-size: 1.2rem;
            font-weight: 600;
        }

        .status-card {
            padding: 1.2rem 1.4rem;
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 20px;
            box-shadow: var(--shadow);
            animation: fadeUp 0.6s ease both;
        }

        .status-row {
            display: flex;
            justify-content: space-between;
            gap: 0.75rem;
            margin-top: 0.4rem;
            font-size: 0.9rem;
            color: var(--muted);
        }

        .bg-glow {
            position: fixed;
            width: 420px;
            height: 420px;
            border-radius: 50%;
            filter: blur(120px);
            opacity: 0.45;
            z-index: 0;
        }

        .glow-1 {
            background: rgba(15, 118, 110, 0.35);
            top: -140px;
            right: -120px;
        }

        .glow-2 {
            background: rgba(249, 115, 22, 0.35);
            bottom: -160px;
            left: -120px;
        }

        div[data-testid="stAltairChart"] > div,
        div[data-testid="stDataFrame"] > div {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 0.75rem;
            box-shadow: var(--shadow);
            animation: fadeUp 0.6s ease both;
        }

        button[kind="primary"] {
            background-color: var(--accent);
            border: 1px solid var(--accent);
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def _render_kpi(label: str, value: str, sub: str, delay_ms: int = 0) -> None:
    st.markdown(
        f"""
        <div class="kpi-card" style="--delay: {delay_ms}ms;">
            <div class="kpi-label">{label}</div>
            <div class="kpi-value">{value}</div>
            <div class="kpi-sub">{sub}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def main() -> None:
    st.set_page_config(
        page_title="Codex Usage Tracker",
        page_icon="C",
        layout="wide",
        initial_sidebar_state="expanded",
    )
    _inject_css()
    st.markdown('<div class="bg-glow glow-1"></div>', unsafe_allow_html=True)
    st.markdown('<div class="bg-glow glow-2"></div>', unsafe_allow_html=True)

    if "codex" not in alt.themes.names():
        alt.themes.register("codex", _altair_theme)
    alt.themes.enable("codex")

    db_default = os.getenv("CODEX_USAGE_DB") or str(default_db_path())
    rollouts_default = os.getenv("CODEX_USAGE_ROLLOUTS") or str(default_rollouts_dir())

    initial_start, initial_end = _select_range_defaults()
    now = datetime.now(STOCKHOLM_TZ)

    with st.sidebar:
        st.markdown("## Data Sources")
        db_path = st.text_input("Database path", value=db_default)
        rollouts_path = st.text_input("Rollouts folder", value=rollouts_default)

        st.markdown("## Filters")
        range_options = ["All time", "Last 7 days", "Last 30 days", "Last 90 days", "Custom"]
        default_index = 0
        if initial_start and initial_end:
            days = (initial_end - initial_start).days
            if days <= 7:
                default_index = 1
            elif days <= 30:
                default_index = 2
            elif days <= 90:
                default_index = 3
            else:
                default_index = 4
        elif initial_start or initial_end:
            default_index = 4

        range_choice = st.selectbox("Range", range_options, index=default_index)
        custom_start = initial_start.date() if initial_start else (now - timedelta(days=30)).date()
        custom_end = initial_end.date() if initial_end else now.date()
        if range_choice == "Custom":
            custom_dates = st.date_input(
                "Custom range",
                value=(custom_start, custom_end),
            )
            if isinstance(custom_dates, tuple) and len(custom_dates) == 2:
                custom_start, custom_end = custom_dates

        group_choice = st.selectbox("Group by", ["day", "week", "month"], index=0)
        breakdown_choice = st.selectbox(
            "Breakdown",
            ["None", "Model", "Directory", "Session"],
            index=0,
        )

        sync_clicked = st.button("Sync rollouts", type="primary", use_container_width=True)

    if range_choice == "All time":
        start = None
        end = None
    elif range_choice == "Last 7 days":
        start = now - timedelta(days=7)
        end = now
    elif range_choice == "Last 30 days":
        start = now - timedelta(days=30)
        end = now
    elif range_choice == "Last 90 days":
        start = now - timedelta(days=90)
        end = now
    else:
        start = datetime.combine(custom_start, time.min, tzinfo=STOCKHOLM_TZ)
        end = datetime.combine(custom_end, time.max, tzinfo=STOCKHOLM_TZ)

    if sync_clicked:
        with st.spinner("Syncing rollouts..."):
            parsed_files, events_count = _sync_rollouts(
                db_path, rollouts_path, start, end
            )
        st.sidebar.success(f"Parsed {parsed_files} files, captured {events_count} events.")
        st.cache_data.clear()

    events = _load_events(db_path)
    if start or end:
        filtered = []
        for event in events:
            captured_at = parse_datetime(event["captured_at"])
            local_dt = to_local(captured_at)
            if start and local_dt < start:
                continue
            if end and local_dt > end:
                continue
            filtered.append(event)
        events = filtered

    enriched = _enrich_events(events)
    df = pd.DataFrame(enriched)

    if df.empty:
        st.markdown(
            """
            <div class="hero">
                <div class="hero-title">Codex Usage Tracker</div>
                <div class="hero-subtitle">
                    No usage data yet. Sync rollouts or start a Codex session to see activity.
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        return

    df["captured_local"] = pd.to_datetime(df["captured_local"])
    df["model"] = df["model"].fillna("<unknown>")
    df["directory"] = df["directory"].fillna("<unknown>")
    df["session_id"] = df["session_id"].fillna("<unknown>")

    model_options = sorted(df["model"].unique().tolist())
    directory_options = sorted(df["directory"].unique().tolist())

    with st.sidebar:
        model_filter = st.multiselect("Models", model_options, default=model_options)
        directory_filter = st.multiselect(
            "Directories", directory_options, default=directory_options
        )

    if model_filter:
        df = df[df["model"].isin(model_filter)]
    if directory_filter:
        df = df[df["directory"].isin(directory_filter)]

    if model_filter or directory_filter:
        filtered_events = []
        allowed_models = set(model_filter) if model_filter else None
        allowed_dirs = set(directory_filter) if directory_filter else None
        for event in events:
            model = event.get("model") or "<unknown>"
            directory = event.get("directory") or "<unknown>"
            if allowed_models and model not in allowed_models:
                continue
            if allowed_dirs and directory not in allowed_dirs:
                continue
            filtered_events.append(event)
        events = filtered_events

    if df.empty:
        st.markdown(
            """
            <div class="hero">
                <div class="hero-title">Codex Usage Tracker</div>
                <div class="hero-subtitle">
                    No usage data matches the current filters. Try widening the range or filters.
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        return

    totals = {field: int(df[field].fillna(0).sum()) for field in TOKEN_FIELDS}
    active_days = int(df["date"].nunique())
    avg_daily = totals["total_tokens"] / active_days if active_days else 0
    last_seen = df["captured_local"].max()
    range_text = _range_label(start, end)

    total_cost, covered, total_events, per_model_cost = _compute_costs(events, default_pricing())
    coverage = (covered / total_events * 100.0) if total_events else 0.0

    hero_html = f"""
        <div class="hero">
            <div class="hero-title">Codex Usage Tracker</div>
            <div class="hero-subtitle">
                Modern usage intelligence for your local Codex activity.
            </div>
            <div class="hero-meta">
                <div class="hero-pill">Range: {range_text}</div>
                <div class="hero-pill">Events: {len(df)}</div>
                <div class="hero-pill">Last seen: {last_seen.strftime("%Y-%m-%d %H:%M")}</div>
                <div class="hero-pill">Models: {df["model"].nunique()}</div>
                <div class="hero-pill">Directories: {df["directory"].nunique()}</div>
            </div>
        </div>
    """
    st.markdown(hero_html, unsafe_allow_html=True)

    kpi_cols = st.columns(5)
    with kpi_cols[0]:
        _render_kpi(
            "Total tokens",
            _format_compact(totals["total_tokens"]),
            f"{totals['total_tokens']:,} tokens",
            0,
        )
    with kpi_cols[1]:
        _render_kpi("Est. cost", _format_currency(total_cost), f"{coverage:.0f}% priced", 80)
    with kpi_cols[2]:
        _render_kpi("Active days", f"{active_days}", "Days with activity", 160)
    with kpi_cols[3]:
        _render_kpi("Avg per day", _format_compact(avg_daily), "Total tokens / active day", 240)
    with kpi_cols[4]:
        top_model = (
            df.groupby("model")["total_tokens"].sum().sort_values(ascending=False).index[0]
        )
        _render_kpi("Top model", top_model, "Most usage this range", 320)

    st.markdown('<div class="section-title">Token Pulse</div>', unsafe_allow_html=True)
    trend_cols = st.columns([2, 1])

    daily = (
        df.groupby("date")["total_tokens"]
        .sum()
        .reset_index()
        .sort_values("date")
    )
    daily["date"] = pd.to_datetime(daily["date"])
    trend_chart = (
        alt.Chart(daily)
        .mark_area(color="#0f766e", opacity=0.15)
        .encode(
            x=alt.X("date:T", title=""),
            y=alt.Y("total_tokens:Q", title="Tokens"),
            tooltip=[
                alt.Tooltip("date:T", title="Date"),
                alt.Tooltip("total_tokens:Q", title="Tokens", format=",.0f"),
            ],
        )
        .properties(height=320)
    )
    trend_line = (
        alt.Chart(daily)
        .mark_line(color="#0f766e", strokeWidth=2.5)
        .encode(x="date:T", y="total_tokens:Q")
    )
    trend = trend_chart + trend_line

    mix_totals = pd.DataFrame(
        {
            "type": ["Input", "Cached", "Output", "Reasoning"],
            "tokens": [
                totals["input_tokens"],
                totals["cached_input_tokens"],
                totals["output_tokens"],
                totals["reasoning_output_tokens"],
            ],
        }
    )
    mix_chart = (
        alt.Chart(mix_totals)
        .mark_arc(innerRadius=70, outerRadius=120)
        .encode(
            theta=alt.Theta("tokens:Q", stack=True),
            color=alt.Color(
                "type:N",
                scale=alt.Scale(range=["#2563eb", "#0f766e", "#f97316", "#16a34a"]),
                legend=alt.Legend(title="Token mix"),
            ),
            tooltip=[
                alt.Tooltip("type:N", title="Type"),
                alt.Tooltip("tokens:Q", title="Tokens", format=",.0f"),
            ],
        )
        .properties(height=320)
    )

    with trend_cols[0]:
        st.altair_chart(trend, use_container_width=True)
    with trend_cols[1]:
        st.altair_chart(mix_chart, use_container_width=True)

    st.markdown('<div class="section-title">Breakdowns</div>', unsafe_allow_html=True)
    breakdown_cols = st.columns(2)

    top_models = (
        df.groupby("model")["total_tokens"]
        .sum()
        .sort_values(ascending=False)
        .head(10)
        .reset_index()
    )
    model_chart = (
        alt.Chart(top_models)
        .mark_bar(color="#2563eb")
        .encode(
            x=alt.X("total_tokens:Q", title="Tokens"),
            y=alt.Y("model:N", sort="-x", title=""),
            tooltip=[
                alt.Tooltip("model:N", title="Model"),
                alt.Tooltip("total_tokens:Q", title="Tokens", format=",.0f"),
            ],
        )
        .properties(height=300)
    )

    top_dirs = (
        df.groupby("directory_label")["total_tokens"]
        .sum()
        .sort_values(ascending=False)
        .head(10)
        .reset_index()
    )
    dir_chart = (
        alt.Chart(top_dirs)
        .mark_bar(color="#0f766e")
        .encode(
            x=alt.X("total_tokens:Q", title="Tokens"),
            y=alt.Y("directory_label:N", sort="-x", title=""),
            tooltip=[
                alt.Tooltip("directory_label:N", title="Directory"),
                alt.Tooltip("total_tokens:Q", title="Tokens", format=",.0f"),
            ],
        )
        .properties(height=300)
    )

    with breakdown_cols[0]:
        st.altair_chart(model_chart, use_container_width=True)
    with breakdown_cols[1]:
        st.altair_chart(dir_chart, use_container_width=True)

    st.markdown('<div class="section-title">Cost and Intensity</div>', unsafe_allow_html=True)
    cost_cols = st.columns([1, 1.3])

    cost_df = (
        pd.DataFrame(
            [{"model": model, "cost": cost} for model, cost in per_model_cost.items()]
        )
        .sort_values("cost", ascending=False)
        .head(10)
    )
    if not cost_df.empty:
        cost_chart = (
            alt.Chart(cost_df)
            .mark_bar(color="#f97316")
            .encode(
                x=alt.X("cost:Q", title="Estimated cost"),
                y=alt.Y("model:N", sort="-x", title=""),
                tooltip=[
                    alt.Tooltip("model:N", title="Model"),
                    alt.Tooltip("cost:Q", title="Cost", format="$,.2f"),
                ],
            )
            .properties(height=300)
        )
    else:
        cost_chart = alt.Chart(pd.DataFrame({"note": ["No priced models"]})).mark_text(
            color="#5b6472", size=14
        )

    heatmap = (
        df.groupby(["weekday", "hour"])["total_tokens"]
        .sum()
        .reset_index()
    )
    weekday_order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    heatmap_chart = (
        alt.Chart(heatmap)
        .mark_rect()
        .encode(
            x=alt.X("hour:O", title="Hour"),
            y=alt.Y("weekday:N", sort=weekday_order, title="Day"),
            color=alt.Color(
                "total_tokens:Q",
                scale=alt.Scale(range=["#f8fafc", "#0f766e"]),
                legend=alt.Legend(title="Tokens"),
            ),
            tooltip=[
                alt.Tooltip("weekday:N", title="Day"),
                alt.Tooltip("hour:O", title="Hour"),
                alt.Tooltip("total_tokens:Q", title="Tokens", format=",.0f"),
            ],
        )
        .properties(height=300)
    )

    with cost_cols[0]:
        st.altair_chart(cost_chart, use_container_width=True)
    with cost_cols[1]:
        st.altair_chart(heatmap_chart, use_container_width=True)

    st.markdown('<div class="section-title">Usage Table</div>', unsafe_allow_html=True)
    breakdown_map = {
        "None": None,
        "Model": "model",
        "Directory": "directory",
        "Session": "session",
    }
    breakdown_key = breakdown_map.get(breakdown_choice)
    rows = aggregate(events, group_choice, breakdown_key)
    table_df = pd.DataFrame([row.__dict__ for row in rows])
    st.dataframe(table_df, use_container_width=True, height=320)

    latest_status = _load_latest_status(db_path)
    if latest_status:
        st.markdown('<div class="section-title">Latest Status</div>', unsafe_allow_html=True)
        status_html = f"""
            <div class="status-card">
                <div><strong>Captured:</strong> {latest_status.get("captured_at", "n/a")}</div>
                <div class="status-row"><span>Model</span><span>{latest_status.get("model") or "n/a"}</span></div>
                <div class="status-row"><span>Directory</span><span>{latest_status.get("directory") or "n/a"}</span></div>
                <div class="status-row"><span>Session</span><span>{latest_status.get("session_id") or "n/a"}</span></div>
                <div class="status-row"><span>Context left</span><span>{latest_status.get("context_percent_left") or 0}%</span></div>
                <div class="status-row"><span>5h limit left</span><span>{latest_status.get("limit_5h_percent_left") or 0}%</span></div>
                <div class="status-row"><span>Weekly limit left</span><span>{latest_status.get("limit_weekly_percent_left") or 0}%</span></div>
            </div>
        """
        st.markdown(status_html, unsafe_allow_html=True)


if __name__ == "__main__":
    main()
