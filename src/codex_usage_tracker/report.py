import csv
import io
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

STOCKHOLM_TZ = ZoneInfo("Europe/Stockholm")


@dataclass
class ReportRow:
    period: str
    group: str
    total_tokens: int
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    reasoning_output_tokens: int


def parse_datetime(value: str) -> datetime:
    value = value.strip()
    if "T" in value:
        return datetime.fromisoformat(value)
    return datetime.fromisoformat(value + "T00:00:00")


def parse_last(value: str) -> timedelta:
    value = value.strip().lower()
    if value.endswith("d"):
        return timedelta(days=int(value[:-1]))
    if value.endswith("h"):
        return timedelta(hours=int(value[:-1]))
    if value.endswith("m"):
        return timedelta(minutes=int(value[:-1]))
    raise ValueError("Invalid --last value, expected Nd/Nh/Nm")


def to_local(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=STOCKHOLM_TZ)
    return dt.astimezone(STOCKHOLM_TZ)


def period_key(dt: datetime, group: str) -> str:
    local_dt = to_local(dt)
    if group == "day":
        return local_dt.strftime("%Y-%m-%d")
    if group == "week":
        week_start = local_dt - timedelta(days=local_dt.weekday())
        return week_start.strftime("%Y-%m-%d")
    if group == "month":
        return local_dt.strftime("%Y-%m")
    raise ValueError("Unsupported group")


def aggregate(
    events: Iterable[Dict[str, object]],
    group: str,
    by: Optional[str] = None,
) -> List[ReportRow]:
    buckets: Dict[Tuple[str, str], ReportRow] = {}

    for event in events:
        captured_at = parse_datetime(event["captured_at"])
        key = period_key(captured_at, group)
        if by == "model":
            group_key = event.get("model") or "<unknown>"
        elif by == "directory":
            group_key = event.get("directory") or "<unknown>"
        elif by == "session":
            group_key = event.get("session_id") or "<unknown>"
        else:
            group_key = "all"

        bucket_key = (key, group_key)
        if bucket_key not in buckets:
            buckets[bucket_key] = ReportRow(
                period=key,
                group=group_key,
                total_tokens=0,
                input_tokens=0,
                cached_input_tokens=0,
                output_tokens=0,
                reasoning_output_tokens=0,
            )

        row = buckets[bucket_key]
        row.total_tokens += int(event.get("total_tokens") or 0)
        row.input_tokens += int(event.get("input_tokens") or 0)
        row.cached_input_tokens += int(event.get("cached_input_tokens") or 0)
        row.output_tokens += int(event.get("output_tokens") or 0)
        row.reasoning_output_tokens += int(event.get("reasoning_output_tokens") or 0)

    return sorted(buckets.values(), key=lambda r: (r.period, r.group))


def render_table(rows: List[ReportRow], include_group: bool) -> str:
    headers = ["Period"]
    if include_group:
        headers.append("Group")
    headers += ["Total", "Input", "Cached", "Output", "Reasoning"]

    data_rows = []
    for row in rows:
        values = [row.period]
        if include_group:
            values.append(row.group)
        values += [
            str(row.total_tokens),
            str(row.input_tokens),
            str(row.cached_input_tokens),
            str(row.output_tokens),
            str(row.reasoning_output_tokens),
        ]
        data_rows.append(values)

    widths = [len(h) for h in headers]
    for values in data_rows:
        for idx, value in enumerate(values):
            widths[idx] = max(widths[idx], len(value))

    def fmt_row(values: List[str]) -> str:
        parts = [value.ljust(widths[idx]) for idx, value in enumerate(values)]
        return "  ".join(parts)

    lines = [fmt_row(headers), fmt_row(["-" * w for w in widths])]
    lines.extend(fmt_row(values) for values in data_rows)
    return "\n".join(lines)


def render_json(rows: List[ReportRow]) -> str:
    payload = [row.__dict__ for row in rows]
    return json.dumps(payload, indent=2)


def render_csv(rows: List[ReportRow]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "period",
            "group",
            "total_tokens",
            "input_tokens",
            "cached_input_tokens",
            "output_tokens",
            "reasoning_output_tokens",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.period,
                row.group,
                row.total_tokens,
                row.input_tokens,
                row.cached_input_tokens,
                row.output_tokens,
                row.reasoning_output_tokens,
            ]
        )
    return buffer.getvalue().rstrip("\n")


def export_events_json(events: Iterable[Dict[str, object]]) -> str:
    payload = list(events)
    return json.dumps(payload, indent=2, default=str)


def export_events_csv(events: Iterable[Dict[str, object]]) -> str:
    rows = list(events)
    if not rows:
        return ""
    headers = list(rows[0].keys())
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=headers)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue()
