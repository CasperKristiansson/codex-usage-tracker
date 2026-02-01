import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Tuple
from .report import STOCKHOLM_TZ
from .store import AppItemMetric, AppTurnMetric, UsageStore


@dataclass
class AppServerStats:
    lines: int = 0
    turns: int = 0
    items: int = 0
    web_actions: int = 0
    errors: int = 0


def _now() -> datetime:
    return datetime.now(STOCKHOLM_TZ)


def _duration_ms(start: Optional[datetime], end: Optional[datetime]) -> Optional[int]:
    if not start or not end:
        return None
    return int((end - start).total_seconds() * 1000)


def _coerce_str(value: Optional[object]) -> Optional[str]:
    if isinstance(value, str):
        return value
    return None


def _get_id(params: Dict[str, object], key: str) -> Optional[str]:
    if key in params and isinstance(params[key], str):
        return params[key]
    snake = key.replace("Id", "_id")
    if snake in params and isinstance(params[snake], str):
        return params[snake]
    return None


def _extract_item_meta(item: Dict[str, object]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    item_type = _coerce_str(item.get("type"))
    command_name = None
    tool_name = None
    if item_type == "commandExecution":
        command = _coerce_str(item.get("command"))
        if command:
            command_name = command.strip().split()[0]
    elif item_type in ("mcpToolCall", "collabAgentToolCall"):
        tool_name = _coerce_str(item.get("tool"))
    return item_type, command_name, tool_name


def _extract_exit_code(item: Dict[str, object]) -> Optional[int]:
    exit_code = item.get("exitCode")
    if exit_code is None:
        return None
    try:
        return int(exit_code)
    except (TypeError, ValueError):
        return None


def _web_action_from_response_item(item: Dict[str, object]) -> Optional[str]:
    if _coerce_str(item.get("type")) != "web_search_call":
        return None
    action = item.get("action")
    if not isinstance(action, dict):
        return None
    action_type = _coerce_str(action.get("type"))
    if not action_type:
        return None
    if "_" in action_type:
        return action_type.lower()
    normalized = []
    for char in action_type:
        if char.isupper():
            normalized.append("_")
            normalized.append(char.lower())
        else:
            normalized.append(char)
    return "".join(normalized).lower()


def ingest_app_server_output(log_path: Path, store: UsageStore) -> AppServerStats:
    stats = AppServerStats()
    stat_info = None
    if log_path.name != "-":
        try:
            stat_info = log_path.stat()
        except OSError:
            stats.errors += 1
            return stats
        if not store.file_needs_ingest(str(log_path), stat_info.st_mtime_ns, stat_info.st_size):
            return stats
        store.delete_app_server_events_for_source(str(log_path))

    turn_starts: Dict[Tuple[Optional[str], Optional[str]], datetime] = {}
    item_starts: Dict[Tuple[Optional[str], Optional[str], Optional[str]], datetime] = {}
    item_meta: Dict[Tuple[Optional[str], Optional[str], Optional[str]], Tuple[Optional[str], Optional[str], Optional[str]]] = {}
    command_output_bytes: Dict[str, int] = {}

    try:
        if log_path.name == "-":
            import sys

            for raw in sys.stdin:
                stats.lines += 1
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(data, dict):
                    continue
                method = data.get("method")
                params = data.get("params") if isinstance(data.get("params"), dict) else {}
                if not isinstance(method, str):
                    continue
                now = _now()

                if method == "turn/started":
                    thread_id = _get_id(params, "threadId")
                    turn = params.get("turn") if isinstance(params.get("turn"), dict) else {}
                    turn_id = _coerce_str(turn.get("id")) or _get_id(params, "turnId")
                    turn_starts[(thread_id, turn_id)] = now
                    continue

                if method == "turn/completed":
                    thread_id = _get_id(params, "threadId")
                    turn = params.get("turn") if isinstance(params.get("turn"), dict) else {}
                    turn_id = _coerce_str(turn.get("id")) or _get_id(params, "turnId")
                    status = _coerce_str(turn.get("status"))
                    started_at = turn_starts.pop((thread_id, turn_id), None)
                    metric = AppTurnMetric(
                        thread_id=thread_id,
                        turn_id=turn_id,
                        status=status,
                        started_at=started_at.isoformat() if started_at else None,
                        completed_at=now.isoformat(),
                        duration_ms=_duration_ms(started_at, now),
                        source=str(log_path),
                    )
                    store.insert_app_turn(metric)
                    stats.turns += 1
                    continue

                if method == "item/started":
                    thread_id = _get_id(params, "threadId")
                    turn_id = _get_id(params, "turnId")
                    item = params.get("item") if isinstance(params.get("item"), dict) else {}
                    item_id = _coerce_str(item.get("id"))
                    key = (thread_id, turn_id, item_id)
                    item_starts[key] = now
                    item_meta[key] = _extract_item_meta(item)
                    continue

                if method == "item/completed":
                    thread_id = _get_id(params, "threadId")
                    turn_id = _get_id(params, "turnId")
                    item = params.get("item") if isinstance(params.get("item"), dict) else {}
                    item_id = _coerce_str(item.get("id"))
                    key = (thread_id, turn_id, item_id)
                    started_at = item_starts.pop(key, None)
                    meta = item_meta.pop(key, (None, None, None))
                    item_type, command_name, tool_name = meta
                    if item_type is None:
                        item_type, command_name, tool_name = _extract_item_meta(item)
                    status = _coerce_str(item.get("status"))
                    output_bytes = None
                    if item_id and item_id in command_output_bytes:
                        output_bytes = command_output_bytes.pop(item_id)
                    metric = AppItemMetric(
                        thread_id=thread_id,
                        turn_id=turn_id,
                        item_id=item_id,
                        item_type=item_type,
                        status=status,
                        started_at=started_at.isoformat() if started_at else None,
                        completed_at=now.isoformat(),
                        duration_ms=_duration_ms(started_at, now),
                        command_name=command_name,
                        exit_code=_extract_exit_code(item),
                        output_bytes=output_bytes,
                        tool_name=tool_name,
                        web_search_action="search" if item_type == "webSearch" else None,
                        source=str(log_path),
                    )
                    store.insert_app_item(metric)
                    stats.items += 1
                    continue

                if method == "item/commandExecution/outputDelta":
                    item_id = _get_id(params, "itemId")
                    delta = params.get("delta")
                    if item_id and isinstance(delta, str):
                        command_output_bytes[item_id] = command_output_bytes.get(item_id, 0) + len(
                            delta.encode("utf-8")
                        )
                    continue

                if method == "rawResponseItem/completed":
                    item = params.get("item") if isinstance(params.get("item"), dict) else {}
                    action = _web_action_from_response_item(item)
                    if not action:
                        continue
                    metric = AppItemMetric(
                        thread_id=_get_id(params, "threadId"),
                        turn_id=_get_id(params, "turnId"),
                        item_id=_coerce_str(item.get("id")),
                        item_type="web_search_action",
                        status=None,
                        started_at=None,
                        completed_at=now.isoformat(),
                        duration_ms=None,
                        command_name=None,
                        exit_code=None,
                        output_bytes=None,
                        tool_name=None,
                        web_search_action=action,
                        source=str(log_path),
                    )
                    store.insert_app_item(metric)
                    stats.web_actions += 1
            return stats

        with log_path.open("r", encoding="utf-8") as handle:
            for raw in handle:
                stats.lines += 1
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(data, dict):
                    continue
                method = data.get("method")
                params = data.get("params") if isinstance(data.get("params"), dict) else {}
                if not isinstance(method, str):
                    continue
                now = _now()

                if method == "turn/started":
                    thread_id = _get_id(params, "threadId")
                    turn = params.get("turn") if isinstance(params.get("turn"), dict) else {}
                    turn_id = _coerce_str(turn.get("id")) or _get_id(params, "turnId")
                    turn_starts[(thread_id, turn_id)] = now
                    continue

                if method == "turn/completed":
                    thread_id = _get_id(params, "threadId")
                    turn = params.get("turn") if isinstance(params.get("turn"), dict) else {}
                    turn_id = _coerce_str(turn.get("id")) or _get_id(params, "turnId")
                    status = _coerce_str(turn.get("status"))
                    started_at = turn_starts.pop((thread_id, turn_id), None)
                    metric = AppTurnMetric(
                        thread_id=thread_id,
                        turn_id=turn_id,
                        status=status,
                        started_at=started_at.isoformat() if started_at else None,
                        completed_at=now.isoformat(),
                        duration_ms=_duration_ms(started_at, now),
                        source=str(log_path),
                    )
                    store.insert_app_turn(metric)
                    stats.turns += 1
                    continue

                if method == "item/started":
                    thread_id = _get_id(params, "threadId")
                    turn_id = _get_id(params, "turnId")
                    item = params.get("item") if isinstance(params.get("item"), dict) else {}
                    item_id = _coerce_str(item.get("id"))
                    key = (thread_id, turn_id, item_id)
                    item_starts[key] = now
                    item_meta[key] = _extract_item_meta(item)
                    continue

                if method == "item/completed":
                    thread_id = _get_id(params, "threadId")
                    turn_id = _get_id(params, "turnId")
                    item = params.get("item") if isinstance(params.get("item"), dict) else {}
                    item_id = _coerce_str(item.get("id"))
                    key = (thread_id, turn_id, item_id)
                    started_at = item_starts.pop(key, None)
                    meta = item_meta.pop(key, (None, None, None))
                    item_type, command_name, tool_name = meta
                    status = _coerce_str(item.get("status"))
                    output_bytes = None
                    if item_id and item_id in command_output_bytes:
                        output_bytes = command_output_bytes.pop(item_id)
                    metric = AppItemMetric(
                        thread_id=thread_id,
                        turn_id=turn_id,
                        item_id=item_id,
                        item_type=item_type,
                        status=status,
                        started_at=started_at.isoformat() if started_at else None,
                        completed_at=now.isoformat(),
                        duration_ms=_duration_ms(started_at, now),
                        command_name=command_name,
                        exit_code=_extract_exit_code(item),
                        output_bytes=output_bytes,
                        tool_name=tool_name,
                        web_search_action="search" if item_type == "webSearch" else None,
                        source=str(log_path),
                    )
                    store.insert_app_item(metric)
                    stats.items += 1
                    continue

                if method == "item/commandExecution/outputDelta":
                    item_id = _get_id(params, "itemId")
                    delta = params.get("delta")
                    if item_id and isinstance(delta, str):
                        command_output_bytes[item_id] = command_output_bytes.get(item_id, 0) + len(
                            delta.encode("utf-8")
                        )
                    continue

                if method == "rawResponseItem/completed":
                    item = params.get("item") if isinstance(params.get("item"), dict) else {}
                    action = _web_action_from_response_item(item)
                    if not action:
                        continue
                    metric = AppItemMetric(
                        thread_id=_get_id(params, "threadId"),
                        turn_id=_get_id(params, "turnId"),
                        item_id=_coerce_str(item.get("id")),
                        item_type="web_search_action",
                        status=None,
                        started_at=None,
                        completed_at=now.isoformat(),
                        duration_ms=None,
                        command_name=None,
                        exit_code=None,
                        output_bytes=None,
                        tool_name=None,
                        web_search_action=action,
                        source=str(log_path),
                    )
                    store.insert_app_item(metric)
                    stats.web_actions += 1
    except OSError:
        stats.errors += 1
        return stats

    if stat_info is not None:
        store.mark_file_ingested(str(log_path), stat_info.st_mtime_ns, stat_info.st_size)

    return stats
