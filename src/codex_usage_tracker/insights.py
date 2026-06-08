from __future__ import annotations

import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, Optional

from .report import PricingConfig, estimate_event_cost
from .store import UsageStore


SUCCESS_STATUSES = {"completed", "complete", "success", "succeeded", "ok"}


def _range_clause(column: str, start: Optional[str], end: Optional[str]) -> tuple[str, list[str]]:
    clauses = []
    params: list[str] = []
    if start:
        clauses.append(f"{column} >= ?")
        params.append(start)
    if end:
        clauses.append(f"{column} <= ?")
        params.append(end)
    if not clauses:
        return "", params
    return " AND " + " AND ".join(clauses), params


def _where_range(column: str, start: Optional[str], end: Optional[str]) -> tuple[str, list[str]]:
    suffix, params = _range_clause(column, start, end)
    if not suffix:
        return "", params
    return "WHERE " + suffix.removeprefix(" AND "), params


def _fetch_count(
    store: UsageStore,
    table: str,
    column: str,
    start: Optional[str],
    end: Optional[str],
) -> int:
    where, params = _where_range(column, start, end)
    try:
        row = store.conn.execute(
            f"SELECT COUNT(*) AS count FROM {table} {where}",
            params,
        ).fetchone()
    except sqlite3.Error:
        return 0
    return int(row["count"] or 0) if row else 0


def _cost_from_row(row: sqlite3.Row | dict[str, object], pricing: PricingConfig) -> float:
    event = {
        "model": row["model"],
        "input_tokens": int(row["input_tokens"] or 0),
        "cached_input_tokens": int(row["cached_input_tokens"] or 0),
        "output_tokens": int(row["output_tokens"] or 0),
    }
    return float(estimate_event_cost(event, pricing) or 0.0)


def _duration_minutes(first_seen: Optional[str], last_seen: Optional[str]) -> float:
    if not first_seen or not last_seen or first_seen == last_seen:
        return 0.0
    try:
        start = datetime.fromisoformat(first_seen.replace("Z", "+00:00"))
        end = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return max((end - start).total_seconds() / 60.0, 0.0)


def _merge_seen(target: dict[str, object], first_seen: object, last_seen: object) -> None:
    if isinstance(first_seen, str):
        current = target.get("first_seen")
        if not isinstance(current, str) or first_seen < current:
            target["first_seen"] = first_seen
    if isinstance(last_seen, str):
        current = target.get("last_seen")
        if not isinstance(current, str) or last_seen > current:
            target["last_seen"] = last_seen


def _tool_issue_sql() -> str:
    placeholders = ",".join("?" for _ in SUCCESS_STATUSES)
    return (
        "status IS NOT NULL AND trim(status) != '' "
        f"AND lower(status) NOT IN ({placeholders})"
    )


def _base_session_rows(
    store: UsageStore,
    start: Optional[str],
    end: Optional[str],
    pricing: PricingConfig,
) -> list[dict[str, object]]:
    sessions: dict[str, dict[str, object]] = {}

    def ensure(session_id: object) -> Optional[dict[str, object]]:
        if not isinstance(session_id, str) or not session_id:
            return None
        row = sessions.setdefault(
            session_id,
            {
                "session_id": session_id,
                "cwd": None,
                "model": None,
                "first_seen": None,
                "last_seen": None,
                "total_tokens": 0,
                "input_tokens": 0,
                "cached_input_tokens": 0,
                "output_tokens": 0,
                "estimated_cost": 0.0,
                "usage_events": 0,
                "turns": 0,
                "messages": 0,
                "tool_calls": 0,
                "tool_issue_signals": 0,
                "payload_truncated": 0,
                "compactions": 0,
                "min_context_percent_left": None,
            },
        )
        return row

    range_suffix, range_params = _range_clause("captured_at_utc", start, end)
    token_rows = store.conn.execute(
        f"""
        SELECT session_id,
               MIN(captured_at_utc) AS first_seen,
               MAX(captured_at_utc) AS last_seen,
               MAX(model) AS model,
               MAX(directory) AS directory,
               COUNT(*) AS usage_events,
               SUM(total_tokens) AS total_tokens,
               SUM(input_tokens) AS input_tokens,
               SUM(cached_input_tokens) AS cached_input_tokens,
               SUM(output_tokens) AS output_tokens,
               MIN(context_percent_left) AS min_context_percent_left
        FROM events
        WHERE event_type IN ('usage_line', 'token_count')
          AND session_id IS NOT NULL
          {range_suffix}
        GROUP BY session_id
        """,
        range_params,
    ).fetchall()
    for token_row in token_rows:
        item = ensure(token_row["session_id"])
        if item is None:
            continue
        item["usage_events"] = int(token_row["usage_events"] or 0)
        item["total_tokens"] = int(token_row["total_tokens"] or 0)
        item["input_tokens"] = int(token_row["input_tokens"] or 0)
        item["cached_input_tokens"] = int(token_row["cached_input_tokens"] or 0)
        item["output_tokens"] = int(token_row["output_tokens"] or 0)
        item["estimated_cost"] = _cost_from_row(token_row, pricing)
        item["model"] = token_row["model"] or item["model"]
        item["cwd"] = token_row["directory"] or item["cwd"]
        if token_row["min_context_percent_left"] is not None:
            item["min_context_percent_left"] = float(token_row["min_context_percent_left"])
        _merge_seen(item, token_row["first_seen"], token_row["last_seen"])

    turn_rows = store.conn.execute(
        f"""
        SELECT session_id,
               MIN(captured_at_utc) AS first_seen,
               MAX(captured_at_utc) AS last_seen,
               MAX(model) AS model,
               MAX(cwd) AS cwd,
               COUNT(*) AS turns
        FROM turns
        WHERE session_id IS NOT NULL
          {range_suffix}
        GROUP BY session_id
        """,
        range_params,
    ).fetchall()
    for turn_row in turn_rows:
        item = ensure(turn_row["session_id"])
        if item is None:
            continue
        item["turns"] = int(turn_row["turns"] or 0)
        item["model"] = item["model"] or turn_row["model"]
        item["cwd"] = item["cwd"] or turn_row["cwd"]
        _merge_seen(item, turn_row["first_seen"], turn_row["last_seen"])

    message_rows = store.conn.execute(
        f"""
        SELECT session_id,
               MIN(captured_at_utc) AS first_seen,
               MAX(captured_at_utc) AS last_seen,
               COUNT(*) AS messages
        FROM messages
        WHERE session_id IS NOT NULL
          {range_suffix}
        GROUP BY session_id
        """,
        range_params,
    ).fetchall()
    for message_row in message_rows:
        item = ensure(message_row["session_id"])
        if item is None:
            continue
        item["messages"] = int(message_row["messages"] or 0)
        _merge_seen(item, message_row["first_seen"], message_row["last_seen"])

    issue_sql = _tool_issue_sql()
    status_params = [status for status in sorted(SUCCESS_STATUSES)]
    tool_rows = store.conn.execute(
        f"""
        SELECT session_id,
               MIN(captured_at_utc) AS first_seen,
               MAX(captured_at_utc) AS last_seen,
               COUNT(*) AS tool_calls,
               SUM(CASE WHEN {issue_sql} THEN 1 ELSE 0 END) AS tool_issue_signals,
               SUM(CASE WHEN payload_truncated THEN 1 ELSE 0 END) AS payload_truncated
        FROM tool_calls
        WHERE session_id IS NOT NULL
          {range_suffix}
        GROUP BY session_id
        """,
        status_params + range_params,
    ).fetchall()
    for tool_row in tool_rows:
        item = ensure(tool_row["session_id"])
        if item is None:
            continue
        item["tool_calls"] = int(tool_row["tool_calls"] or 0)
        item["tool_issue_signals"] = int(tool_row["tool_issue_signals"] or 0)
        item["payload_truncated"] = int(tool_row["payload_truncated"] or 0)
        _merge_seen(item, tool_row["first_seen"], tool_row["last_seen"])

    compaction_rows = store.conn.execute(
        f"""
        SELECT session_id,
               COUNT(*) AS compactions
        FROM events
        WHERE event_type = 'context_compacted'
          AND session_id IS NOT NULL
          {range_suffix}
        GROUP BY session_id
        """,
        range_params,
    ).fetchall()
    for compaction_row in compaction_rows:
        item = ensure(compaction_row["session_id"])
        if item is not None:
            item["compactions"] = int(compaction_row["compactions"] or 0)

    meta_range, meta_params = _range_clause(
        "COALESCE(session_timestamp_utc, captured_at_utc)", start, end
    )
    meta_rows = store.conn.execute(
        f"""
        SELECT session_id,
               COALESCE(session_timestamp_utc, captured_at_utc) AS seen_at,
               cwd
        FROM sessions
        WHERE session_id IS NOT NULL
          {meta_range}
        """,
        meta_params,
    ).fetchall()
    for meta_row in meta_rows:
        item = ensure(meta_row["session_id"])
        if item is None:
            continue
        item["cwd"] = item["cwd"] or meta_row["cwd"]
        _merge_seen(item, meta_row["seen_at"], meta_row["seen_at"])

    for item in sessions.values():
        item["duration_minutes"] = _duration_minutes(
            item.get("first_seen") if isinstance(item.get("first_seen"), str) else None,
            item.get("last_seen") if isinstance(item.get("last_seen"), str) else None,
        )
    return list(sessions.values())


def _apply_session_filters(
    store: UsageStore,
    rows: list[dict[str, object]],
    cwd: Optional[str],
    model: Optional[str],
    search: Optional[str],
) -> list[dict[str, object]]:
    filtered = rows
    if cwd:
        needle = cwd.lower()
        filtered = [
            row for row in filtered
            if needle in str(row.get("cwd") or "").lower()
        ]
    if model:
        needle = model.lower()
        filtered = [
            row for row in filtered
            if needle in str(row.get("model") or "").lower()
        ]
    if search:
        matching = _matching_message_sessions(store, search)
        filtered = [
            row for row in filtered
            if row.get("session_id") in matching
        ]
    return filtered


def _matching_message_sessions(store: UsageStore, query: str) -> set[str]:
    phrase = '"' + query.replace('"', '""') + '"'
    try:
        rows = store.conn.execute(
            """
            SELECT DISTINCT messages.session_id
            FROM messages_fts
            JOIN messages ON messages.id = messages_fts.rowid
            WHERE messages_fts MATCH ?
              AND messages.session_id IS NOT NULL
            """,
            (phrase,),
        ).fetchall()
    except sqlite3.Error:
        rows = store.conn.execute(
            """
            SELECT DISTINCT session_id
            FROM messages
            WHERE content LIKE ?
              AND session_id IS NOT NULL
            """,
            (f"%{query}%",),
        ).fetchall()
    return {
        str(row["session_id"])
        for row in rows
        if row["session_id"]
    }


def _with_scores(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    if not rows:
        return []
    max_cost = max(float(row.get("estimated_cost") or 0.0) for row in rows) or 1.0
    max_tokens = max(int(row.get("total_tokens") or 0) for row in rows) or 1
    max_duration = max(float(row.get("duration_minutes") or 0.0) for row in rows) or 1.0
    max_messages = max(int(row.get("messages") or 0) for row in rows) or 1
    max_tools = max(int(row.get("tool_calls") or 0) for row in rows) or 1
    max_issues = max(int(row.get("tool_issue_signals") or 0) for row in rows) or 1
    max_compactions = max(int(row.get("compactions") or 0) for row in rows) or 1

    scored = []
    for row in rows:
        context_left = row.get("min_context_percent_left")
        context_pressure = 0.0
        if isinstance(context_left, (int, float)):
            context_pressure = max(0.0, min((25.0 - float(context_left)) / 25.0, 1.0))
        volume = (
            (int(row.get("messages") or 0) / max_messages)
            + (int(row.get("tool_calls") or 0) / max_tools)
        ) / 2.0
        score = (
            30.0 * (float(row.get("estimated_cost") or 0.0) / max_cost)
            + 20.0 * (int(row.get("total_tokens") or 0) / max_tokens)
            + 15.0 * (int(row.get("tool_issue_signals") or 0) / max_issues)
            + 12.0 * (int(row.get("compactions") or 0) / max_compactions)
            + 10.0 * (float(row.get("duration_minutes") or 0.0) / max_duration)
            + 8.0 * volume
            + 5.0 * context_pressure
        )
        updated = dict(row)
        updated["interesting_score"] = round(score, 1)
        scored.append(updated)
    return scored


def session_insights(
    store: UsageStore,
    start: Optional[str],
    end: Optional[str],
    pricing: PricingConfig,
    *,
    limit: int = 20,
    interesting: bool = False,
    cwd: Optional[str] = None,
    model: Optional[str] = None,
    search: Optional[str] = None,
) -> list[dict[str, object]]:
    rows = _base_session_rows(store, start, end, pricing)
    rows = _apply_session_filters(store, rows, cwd, model, search)
    if interesting:
        rows = _with_scores(rows)
        rows.sort(
            key=lambda item: (
                float(item.get("interesting_score") or 0.0),
                float(item.get("estimated_cost") or 0.0),
                int(item.get("total_tokens") or 0),
            ),
            reverse=True,
        )
    else:
        for row in rows:
            row["interesting_score"] = 0.0
        rows.sort(key=lambda item: str(item.get("last_seen") or ""), reverse=True)
    return rows[: max(limit, 1)]


def _group_usage(
    store: UsageStore,
    field: str,
    start: Optional[str],
    end: Optional[str],
    pricing: PricingConfig,
    limit: int,
) -> list[dict[str, object]]:
    range_suffix, range_params = _range_clause("captured_at_utc", start, end)
    rows = store.conn.execute(
        f"""
        SELECT COALESCE({field}, '(unknown)') AS name,
               COUNT(*) AS usage_events,
               SUM(total_tokens) AS total_tokens,
               SUM(input_tokens) AS input_tokens,
               SUM(cached_input_tokens) AS cached_input_tokens,
               SUM(output_tokens) AS output_tokens
        FROM events
        WHERE event_type IN ('usage_line', 'token_count')
          {range_suffix}
        GROUP BY COALESCE({field}, '(unknown)')
        ORDER BY SUM(total_tokens) DESC
        LIMIT ?
        """,
        range_params + [max(limit, 1)],
    ).fetchall()
    output = []
    for row in rows:
        item = dict(row)
        item["estimated_cost"] = _cost_from_row(
            {
                "model": row["name"] if field == "model" else None,
                "input_tokens": row["input_tokens"],
                "cached_input_tokens": row["cached_input_tokens"],
                "output_tokens": row["output_tokens"],
            },
            pricing,
        )
        output.append(item)
    return output


def _top_tools(
    store: UsageStore,
    start: Optional[str],
    end: Optional[str],
    limit: int,
) -> list[dict[str, object]]:
    range_suffix, range_params = _range_clause("captured_at_utc", start, end)
    issue_sql = _tool_issue_sql()
    status_params = [status for status in sorted(SUCCESS_STATUSES)]
    rows = store.conn.execute(
        f"""
        SELECT COALESCE(tool_name, tool_type, '(unknown)') AS name,
               COUNT(*) AS count,
               SUM(CASE WHEN {issue_sql} THEN 1 ELSE 0 END) AS issue_signals,
               SUM(CASE WHEN payload_truncated THEN 1 ELSE 0 END) AS truncated
        FROM tool_calls
        WHERE 1 = 1
          {range_suffix}
        GROUP BY COALESCE(tool_name, tool_type, '(unknown)')
        ORDER BY COUNT(*) DESC
        LIMIT ?
        """,
        status_params + range_params + [max(limit, 1)],
    ).fetchall()
    return [dict(row) for row in rows]


def _compaction_count(store: UsageStore, start: Optional[str], end: Optional[str]) -> int:
    event_range, event_params = _range_clause("captured_at_utc", start, end)
    activity_range, activity_params = _range_clause("captured_at_utc", start, end)
    event_row = store.conn.execute(
        f"""
        SELECT COUNT(*) AS count
        FROM events
        WHERE event_type = 'context_compacted'
          {event_range}
        """,
        event_params,
    ).fetchone()
    activity_row = store.conn.execute(
        f"""
        SELECT COUNT(*) AS count
        FROM activity_events
        WHERE event_name = 'compaction'
          {activity_range}
        """,
        activity_params,
    ).fetchone()
    return int(event_row["count"] or 0) + int(activity_row["count"] or 0)


def _distinct_session_count(store: UsageStore, start: Optional[str], end: Optional[str]) -> int:
    parts = []
    params: list[str] = []
    for table, column in (
        ("events", "captured_at_utc"),
        ("turns", "captured_at_utc"),
        ("messages", "captured_at_utc"),
        ("tool_calls", "captured_at_utc"),
    ):
        range_suffix, range_params = _range_clause(column, start, end)
        parts.append(
            f"""
            SELECT session_id
            FROM {table}
            WHERE session_id IS NOT NULL
              {range_suffix}
            """
        )
        params.extend(range_params)
    range_suffix, range_params = _range_clause(
        "COALESCE(session_timestamp_utc, captured_at_utc)", start, end
    )
    parts.append(
        f"""
        SELECT session_id
        FROM sessions
        WHERE session_id IS NOT NULL
          {range_suffix}
        """
    )
    params.extend(range_params)
    row = store.conn.execute(
        "SELECT COUNT(DISTINCT session_id) AS count FROM (" + " UNION ALL ".join(parts) + ")",
        params,
    ).fetchone()
    return int(row["count"] or 0) if row else 0


def period_summary(
    store: UsageStore,
    start: Optional[str],
    end: Optional[str],
    pricing: PricingConfig,
) -> dict[str, object]:
    range_suffix, range_params = _range_clause("captured_at_utc", start, end)
    token_row = store.conn.execute(
        f"""
        SELECT COUNT(*) AS usage_events,
               SUM(total_tokens) AS total_tokens,
               SUM(input_tokens) AS input_tokens,
               SUM(cached_input_tokens) AS cached_input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(reasoning_output_tokens) AS reasoning_output_tokens,
               MIN(context_percent_left) AS min_context_percent_left
        FROM events
        WHERE event_type IN ('usage_line', 'token_count')
          {range_suffix}
        """,
        range_params,
    ).fetchone()
    total_cost = 0.0
    for row in store.conn.execute(
        f"""
        SELECT model,
               SUM(input_tokens) AS input_tokens,
               SUM(cached_input_tokens) AS cached_input_tokens,
               SUM(output_tokens) AS output_tokens
        FROM events
        WHERE event_type IN ('usage_line', 'token_count')
          {range_suffix}
        GROUP BY model
        """,
        range_params,
    ).fetchall():
        total_cost += _cost_from_row(row, pricing)

    issue_sql = _tool_issue_sql()
    status_params = [status for status in sorted(SUCCESS_STATUSES)]
    tool_issue_row = store.conn.execute(
        f"""
        SELECT SUM(CASE WHEN {issue_sql} THEN 1 ELSE 0 END) AS issue_signals
        FROM tool_calls
        WHERE 1 = 1
          {range_suffix}
        """,
        status_params + range_params,
    ).fetchone()
    app_issue_extra, app_issue_params = _range_clause("completed_at", start, end)
    app_issue_row = store.conn.execute(
        f"""
        SELECT COUNT(*) AS count
        FROM app_items
        WHERE exit_code IS NOT NULL
          AND exit_code != 0
          {app_issue_extra}
        """,
        app_issue_params,
    ).fetchone()

    return {
        "start": start,
        "end": end,
        "usage_events": int(token_row["usage_events"] or 0),
        "total_tokens": int(token_row["total_tokens"] or 0),
        "input_tokens": int(token_row["input_tokens"] or 0),
        "cached_input_tokens": int(token_row["cached_input_tokens"] or 0),
        "output_tokens": int(token_row["output_tokens"] or 0),
        "reasoning_output_tokens": int(token_row["reasoning_output_tokens"] or 0),
        "estimated_cost": total_cost,
        "sessions": _distinct_session_count(store, start, end),
        "messages": _fetch_count(store, "messages", "captured_at_utc", start, end),
        "tool_calls": _fetch_count(store, "tool_calls", "captured_at_utc", start, end),
        "tool_issue_signals": int(tool_issue_row["issue_signals"] or 0)
        + int(app_issue_row["count"] or 0),
        "compactions": _compaction_count(store, start, end),
        "min_context_percent_left": (
            float(token_row["min_context_percent_left"])
            if token_row["min_context_percent_left"] is not None
            else None
        ),
    }


def insight_payload(
    store: UsageStore,
    start: Optional[str],
    end: Optional[str],
    pricing: PricingConfig,
    *,
    limit: int = 10,
) -> dict[str, object]:
    return {
        "summary": period_summary(store, start, end, pricing),
        "interesting_sessions": session_insights(
            store, start, end, pricing, limit=limit, interesting=True
        ),
        "top_expensive_sessions": sorted(
            session_insights(store, start, end, pricing, limit=max(limit * 3, 10)),
            key=lambda row: float(row.get("estimated_cost") or 0.0),
            reverse=True,
        )[:limit],
        "top_models": _group_usage(store, "model", start, end, pricing, limit),
        "top_directories": _group_usage(store, "directory", start, end, pricing, limit),
        "top_tools": _top_tools(store, start, end, limit),
    }


def compare_payload(
    store: UsageStore,
    current_start: Optional[str],
    current_end: Optional[str],
    baseline_start: Optional[str],
    baseline_end: Optional[str],
    pricing: PricingConfig,
    *,
    limit: int = 10,
) -> dict[str, object]:
    current = period_summary(store, current_start, current_end, pricing)
    baseline = period_summary(store, baseline_start, baseline_end, pricing)
    keys = [
        "estimated_cost",
        "total_tokens",
        "input_tokens",
        "cached_input_tokens",
        "output_tokens",
        "sessions",
        "messages",
        "tool_calls",
        "tool_issue_signals",
        "compactions",
    ]
    deltas = {}
    for key in keys:
        current_value = float(current.get(key) or 0)
        baseline_value = float(baseline.get(key) or 0)
        delta = current_value - baseline_value
        percent = None if baseline_value == 0 else (delta / baseline_value) * 100.0
        deltas[key] = {
            "current": current_value,
            "baseline": baseline_value,
            "delta": delta,
            "percent": percent,
        }
    return {
        "current": current,
        "baseline": baseline,
        "deltas": deltas,
        "current_top_sessions": session_insights(
            store, current_start, current_end, pricing, limit=limit, interesting=True
        ),
        "current_top_models": _group_usage(
            store, "model", current_start, current_end, pricing, limit
        ),
        "baseline_top_models": _group_usage(
            store, "model", baseline_start, baseline_end, pricing, limit
        ),
        "current_top_tools": _top_tools(store, current_start, current_end, limit),
        "baseline_top_tools": _top_tools(store, baseline_start, baseline_end, limit),
    }


def doctor_payload(store: UsageStore, *, quick_sample_query: str = "codex") -> dict[str, object]:
    checks = []

    def add_check(name: str, status: str, detail: str, **extra: object) -> None:
        item = {"name": name, "status": status, "detail": detail}
        item.update(extra)
        checks.append(item)

    db_path = Path(store.path)
    add_check(
        "database",
        "PASS" if db_path.exists() else "FAIL",
        str(db_path),
        bytes=db_path.stat().st_size if db_path.exists() else 0,
    )
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(db_path) + suffix)
        if sidecar.exists():
            add_check(
                suffix.removeprefix("-"),
                "PASS",
                str(sidecar),
                bytes=sidecar.stat().st_size,
            )

    meta = {
        row["key"]: row["value"]
        for row in store.conn.execute("SELECT key, value FROM meta").fetchall()
    }
    for key in ("schema_version", "ingest_version", "storage_profile_version"):
        add_check(key, "PASS" if meta.get(key) else "WARN", str(meta.get(key) or "missing"))

    row_counts = {}
    for table in (
        "events",
        "sessions",
        "turns",
        "messages",
        "tool_calls",
        "activity_events",
        "ingestion_files",
    ):
        try:
            row = store.conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()
            row_counts[table] = int(row["count"] or 0)
        except sqlite3.Error as exc:
            add_check(f"table:{table}", "FAIL", str(exc))
    add_check("row_counts", "PASS", "Core table counts collected", counts=row_counts)

    indexes = {
        row["name"]
        for row in store.conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index'"
        ).fetchall()
    }
    required_indexes = {
        "events_event_type_captured_at_utc_idx",
        "messages_session_idx",
        "messages_captured_at_utc_idx",
        "tool_calls_session_idx",
        "tool_calls_captured_at_utc_desc_idx",
    }
    missing_indexes = sorted(required_indexes - indexes)
    add_check(
        "indexes",
        "PASS" if not missing_indexes else "WARN",
        "Required read-side indexes are present" if not missing_indexes else "Missing indexes",
        missing=missing_indexes,
    )

    try:
        trigger_count = store.conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM sqlite_master
            WHERE type = 'trigger'
              AND name IN ('messages_ai', 'messages_ad', 'messages_au')
            """
        ).fetchone()["count"]
        message_count = row_counts.get("messages", 0)
        fts_count = store.conn.execute(
            "SELECT COUNT(*) AS count FROM messages_fts"
        ).fetchone()["count"]
        status = "PASS" if int(trigger_count or 0) == 3 and int(fts_count or 0) == message_count else "WARN"
        add_check(
            "fts5",
            status,
            "messages_fts available",
            messages=message_count,
            fts_rows=int(fts_count or 0),
            triggers=int(trigger_count or 0),
        )
    except sqlite3.Error as exc:
        add_check("fts5", "WARN", f"messages_fts unavailable: {exc}")

    missing_hashes = store.conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM ingestion_files
        WHERE content_hash IS NULL
        """
    ).fetchone()["count"]
    add_check(
        "content_hashes",
        "PASS" if int(missing_hashes or 0) == 0 else "WARN",
        f"{int(missing_hashes or 0)} ingestion files missing content_hash",
    )

    timings: Dict[str, float] = {}
    for name, sql, params in (
        (
            "latest_status",
            "SELECT * FROM events WHERE event_type IN ('status_snapshot', 'token_count') ORDER BY captured_at DESC LIMIT 1",
            (),
        ),
        (
            "recent_sessions",
            "SELECT session_id FROM sessions ORDER BY COALESCE(session_timestamp_utc, captured_at_utc) DESC LIMIT 20",
            (),
        ),
        (
            "fts_sample",
            """
            SELECT messages.session_id
            FROM messages_fts
            JOIN messages ON messages.id = messages_fts.rowid
            WHERE messages_fts MATCH ?
            LIMIT 20
            """,
            ('"' + quick_sample_query.replace('"', '""') + '"',),
        ),
    ):
        started = time.perf_counter()
        try:
            store.conn.execute(sql, params).fetchall()
            timings[name] = (time.perf_counter() - started) * 1000.0
        except sqlite3.Error:
            timings[name] = -1.0
    add_check("query_timings", "PASS", "Quick read timings collected", milliseconds=timings)

    return {
        "path": str(db_path),
        "checks": checks,
        "summary": {
            "pass": sum(1 for check in checks if check["status"] == "PASS"),
            "warn": sum(1 for check in checks if check["status"] == "WARN"),
            "fail": sum(1 for check in checks if check["status"] == "FAIL"),
        },
    }
