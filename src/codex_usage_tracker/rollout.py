import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, Iterator, Optional, Tuple
from zoneinfo import ZoneInfo

from .report import STOCKHOLM_TZ

BASELINE_TOKENS = 12000


@dataclass
class RolloutContext:
    session_id: Optional[str] = None
    directory: Optional[str] = None
    codex_version: Optional[str] = None
    model: Optional[str] = None


@dataclass
class ParsedTokenCount:
    captured_at_local: datetime
    captured_at_utc: datetime
    tokens: Dict[str, int]
    context_used: Optional[int]
    context_total: Optional[int]
    context_percent_left: Optional[int]
    limit_5h_percent_left: Optional[float]
    limit_5h_resets_at: Optional[str]
    limit_weekly_percent_left: Optional[float]
    limit_weekly_resets_at: Optional[str]


def iter_rollout_files(root: Path) -> Iterator[Path]:
    if not root.exists():
        return
    for path in root.rglob("rollout-*.jsonl"):
        if path.is_file():
            yield path


def parse_rollout_timestamp(value: str) -> datetime:
    value = value.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt


def _format_reset_timestamp(reset_seconds: Optional[int], captured_at: datetime) -> Optional[str]:
    if reset_seconds is None:
        return None
    dt = datetime.fromtimestamp(reset_seconds, tz=ZoneInfo("UTC")).astimezone(STOCKHOLM_TZ)
    captured_local = captured_at.astimezone(STOCKHOLM_TZ)
    time_text = dt.strftime("%H:%M")
    if dt.date() == captured_local.date():
        return time_text
    day_text = dt.strftime("%-d %b")
    return f"{time_text} on {day_text}"


def _percent_left(used_percent: Optional[float]) -> Optional[float]:
    if used_percent is None:
        return None
    return max(0.0, min(100.0, 100.0 - used_percent))


def _context_percent_left(total_tokens: Optional[int], context_window: Optional[int]) -> Optional[int]:
    if total_tokens is None or context_window is None:
        return None
    if context_window <= BASELINE_TOKENS:
        return 0
    effective_window = context_window - BASELINE_TOKENS
    used = max(0, total_tokens - BASELINE_TOKENS)
    remaining = max(0, effective_window - used)
    return int(round((remaining / effective_window) * 100.0))


def parse_rollout_line(
    raw: str,
    context: RolloutContext,
) -> Tuple[Optional[ParsedTokenCount], RolloutContext]:
    data = json.loads(raw)
    item_type = data.get("type")
    payload = data.get("payload") or {}

    if item_type == "session_meta":
        context.session_id = payload.get("id") or context.session_id
        context.directory = payload.get("cwd") or context.directory
        context.codex_version = payload.get("cli_version") or context.codex_version
        return None, context

    if item_type == "turn_context":
        context.model = payload.get("model") or context.model
        context.directory = payload.get("cwd") or context.directory
        return None, context

    if item_type != "event_msg":
        return None, context

    event_type = payload.get("type")
    if event_type != "token_count":
        return None, context

    event_payload = payload.get("payload") or {}
    info = event_payload.get("info") or {}
    last_usage = info.get("last_token_usage") or {}
    total_usage = info.get("total_token_usage") or {}
    model_context_window = info.get("model_context_window")

    timestamp = data.get("timestamp")
    if not timestamp:
        return None, context
    captured_at_utc = parse_rollout_timestamp(timestamp)
    captured_at_local = captured_at_utc.astimezone(STOCKHOLM_TZ)

    tokens = {
        "total_tokens": int(last_usage.get("total_tokens") or 0),
        "input_tokens": int(last_usage.get("input_tokens") or 0),
        "cached_input_tokens": int(last_usage.get("cached_input_tokens") or 0),
        "output_tokens": int(last_usage.get("output_tokens") or 0),
        "reasoning_output_tokens": int(last_usage.get("reasoning_output_tokens") or 0),
    }

    context_used = total_usage.get("total_tokens")
    if context_used is not None:
        context_used = int(context_used)

    if model_context_window is not None:
        model_context_window = int(model_context_window)

    context_percent_left = _context_percent_left(context_used, model_context_window)

    limits = event_payload.get("rate_limits") or {}
    primary = limits.get("primary") or {}
    secondary = limits.get("secondary") or {}
    primary_used = primary.get("used_percent")
    secondary_used = secondary.get("used_percent")

    limit_5h_percent_left = _percent_left(primary_used)
    limit_weekly_percent_left = _percent_left(secondary_used)

    limit_5h_resets_at = _format_reset_timestamp(primary.get("resets_at"), captured_at_local)
    limit_weekly_resets_at = _format_reset_timestamp(
        secondary.get("resets_at"), captured_at_local
    )

    parsed = ParsedTokenCount(
        captured_at_local=captured_at_local,
        captured_at_utc=captured_at_utc,
        tokens=tokens,
        context_used=context_used,
        context_total=model_context_window,
        context_percent_left=context_percent_left,
        limit_5h_percent_left=limit_5h_percent_left,
        limit_5h_resets_at=limit_5h_resets_at,
        limit_weekly_percent_left=limit_weekly_percent_left,
        limit_weekly_resets_at=limit_weekly_resets_at,
    )
    return parsed, context
