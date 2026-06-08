import argparse
import hashlib
import json
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Callable, Dict, Iterable, Literal, Optional, Tuple
from zoneinfo import ZoneInfo

from .config import (
    DEFAULT_TIMEZONE,
    is_valid_timezone,
    resolve_timezone,
)
from .hash_utils import compute_file_hash
from .insights import (
    compare_payload,
    doctor_payload,
    insight_payload,
    session_insights,
)
from .platform import default_config_path, default_db_path, default_rollouts_dir
from .pricing_cli import (
    pricing_status,
    remove_pricing_override,
    update_pricing_model,
)
from .report import (
    PricingConfig,
    aggregate,
    compute_costs,
    default_pricing,
    export_events_csv,
    export_events_json,
    load_pricing_config,
    parse_datetime,
    parse_last,
    render_csv,
    render_json,
    render_table,
    to_local,
)
from .rollout import RolloutContext, iter_rollout_files, parse_rollout_line
from .app_server import ingest_app_server_output
from .parser import StatusCapture, map_limits, parse_token_usage_line
from .store import (
    ActivityEvent,
    MessageEvent,
    SessionMeta,
    ToolCallEvent,
    TurnContext,
    UsageEvent,
    UsageStore,
)

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows fallback
    fcntl = None


@dataclass
class IngestStats:
    files_total: int = 0
    files_parsed: int = 0
    files_skipped: int = 0
    lines: int = 0
    events: int = 0
    errors: int = 0
    started_at: Optional[float] = None
    updated_at: Optional[float] = None
    current_file: Optional[str] = None
    error_samples: list[dict[str, object]] = field(default_factory=list)


@dataclass
class CliLogStats:
    lines: int = 0
    status_snapshots: int = 0
    usage_lines: int = 0
    events: int = 0


@dataclass
class ParsedRolloutFile:
    file_path: Path
    mtime_ns: int
    size: int
    content_hash: Optional[str] = None
    lines: int = 0
    sessions: list[SessionMeta] = field(default_factory=list)
    events: list[UsageEvent] = field(default_factory=list)
    turns: list[TurnContext] = field(default_factory=list)
    activity: list[ActivityEvent] = field(default_factory=list)
    messages: list[MessageEvent] = field(default_factory=list)
    tool_calls: list[ToolCallEvent] = field(default_factory=list)
    errors: int = 0
    error_samples: list[dict[str, object]] = field(default_factory=list)


IngestMode = Literal["full", "redact_payloads", "none"]

LEAN_ACTIVITY_EVENT_TYPES = {
    "assistant_message",
    "shell_command",
    "tool_call",
    "tool_name",
    "user_message",
}
LEAN_DROPPED_TOOL_TYPES = {
    "custom_tool_call_output",
    "function_call_output",
}
MAX_TOOL_PAYLOAD_CHARS = 4096
MAX_TOOL_COMMAND_CHARS = 4096
DEFAULT_INGEST_WORKERS = max(1, os.cpu_count() or 1)
_INGEST_LOCK_DEPTH = 0


def _should_store_activity_event(event_type: str, ingest_mode: IngestMode) -> bool:
    return event_type not in LEAN_ACTIVITY_EVENT_TYPES


def _resolve_ingest_mode(args: argparse.Namespace, db_path: Path) -> IngestMode:
    """
    Resolve ingest mode from flags and config.json.

    Defaults to storing messages and capped tool payload previews.
    """
    no_content = bool(getattr(args, "no_content", False))
    no_payloads = bool(getattr(args, "no_payloads", False))
    with_payloads = bool(getattr(args, "with_payloads", False))

    if sum([no_content, no_payloads, with_payloads]) > 1:
        raise ValueError(
            "Ingest flags are mutually exclusive: use only one of "
            "--no-content/--redact, --no-payloads, or --with-payloads."
        )

    if no_content:
        return "none"
    if with_payloads:
        return "full"
    if no_payloads:
        return "redact_payloads"
    return "full"


class ProgressPrinter:
    def __init__(self, total: int) -> None:
        self.total = total
        self._last_len = 0
        self._enabled = sys.stderr.isatty()

    def update(self, current: int, stats: IngestStats, file_path: Optional[Path] = None) -> None:
        if not self._enabled:
            return
        parts = [
            f"Ingesting rollouts: {current}/{self.total} files",
            f"parsed {stats.files_parsed}",
            f"skipped {stats.files_skipped}",
            f"events {stats.events}",
            f"errors {stats.errors}",
        ]
        if file_path is not None:
            parts.append(f"{file_path.name}")
        line = " | ".join(parts)
        padded = line.ljust(self._last_len)
        sys.stderr.write("\r" + padded)
        sys.stderr.flush()
        self._last_len = len(line)

    def finish(self) -> None:
        if self._enabled and self._last_len:
            sys.stderr.write("\n")
            sys.stderr.flush()


def _open_browser(url: str, delay: float = 0.8) -> None:
    def _runner() -> None:
        time.sleep(delay)
        webbrowser.open(url)

    threading.Thread(target=_runner, daemon=True).start()


def _is_port_available(port: int, host: str = "127.0.0.1") -> bool:
    if port < 1 or port > 65535:
        return False
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def _resolve_web_port(requested_port: int, max_port: int = 65535) -> int:
    if requested_port < 1 or requested_port > max_port:
        raise ValueError(
            f"Invalid port {requested_port}. Expected a value between 1 and {max_port}."
        )
    for port in range(requested_port, max_port + 1):
        if _is_port_available(port):
            return port
    raise RuntimeError(
        f"No available port found in range {requested_port}-{max_port}."
    )


def _resolve_ui_dist(repo_root: Path) -> Optional[Path]:
    if os.environ.get("CODEX_USAGE_UI_DEV"):
        return None
    env_path = os.environ.get("CODEX_USAGE_UI_DIST")
    if env_path:
        candidate = Path(env_path)
        if candidate.exists():
            return candidate
    candidate = repo_root / "dist" / "ui"
    if candidate.exists():
        return candidate
    return None


def _select_rollout_files(
    root: Path,
    start: Optional[datetime],
    end: Optional[datetime],
    tz: ZoneInfo,
) -> Iterable[Tuple[Path, int, int, datetime]]:
    for path in iter_rollout_files(root):
        try:
            stat = path.stat()
        except OSError:
            continue
        mtime = datetime.fromtimestamp(stat.st_mtime, tz=tz)
        if start and mtime < start:
            continue
        if end and mtime > end:
            continue
        yield path, stat.st_mtime_ns, stat.st_size, mtime


def _truncate_error_line(value: str, limit: int = 200) -> str:
    cleaned = value.replace("\n", " ").replace("\r", " ")
    if len(cleaned) <= limit:
        return cleaned
    trim = max(limit - 3, 0)
    return cleaned[:trim] + "..."


def _record_ingest_error(
    stats: IngestStats | ParsedRolloutFile,
    file_path: Path,
    line_number: Optional[int],
    raw: Optional[str],
    error: Exception,
    label: str,
    error_sample_limit: int,
    verbose: bool,
    strict: bool,
) -> None:
    stats.errors += 1
    location = f"{file_path}"
    if line_number:
        location = f"{location}:{line_number}"
    if verbose:
        sys.stderr.write(f"{label} in {location}: {error}\n")
        if raw:
            sys.stderr.write(f"  {_truncate_error_line(raw)}\n")
        sys.stderr.flush()
    elif len(stats.error_samples) < error_sample_limit:
        stats.error_samples.append(
            {
                "file": str(file_path),
                "line": line_number,
                "error": f"{label}: {error}",
                "snippet": _truncate_error_line(raw) if raw else None,
            }
        )
    if strict:
        raise RuntimeError(f"{label} in {location}: {error}") from error


def _payload_preview(
    value: Optional[str],
    limit: int = MAX_TOOL_PAYLOAD_CHARS,
) -> tuple[Optional[str], Optional[int], bool]:
    if value is None:
        return None, None, False
    length = len(value)
    if length <= limit:
        return value, length, False
    return value[:limit], length, True


def _resolve_ingest_workers(workers: Optional[int]) -> int:
    if workers is None or workers <= 0:
        return DEFAULT_INGEST_WORKERS
    return max(1, workers)


def _acquire_ingestion_lock(db_path: Path):
    global _INGEST_LOCK_DEPTH
    if _INGEST_LOCK_DEPTH > 0:
        _INGEST_LOCK_DEPTH += 1
        return None
    lock_path = db_path.with_name(f"{db_path.name}.ingest.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a")
    if fcntl is not None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    _INGEST_LOCK_DEPTH = 1
    return handle


def _release_ingestion_lock(handle) -> None:
    global _INGEST_LOCK_DEPTH
    if _INGEST_LOCK_DEPTH > 1:
        _INGEST_LOCK_DEPTH -= 1
        return
    _INGEST_LOCK_DEPTH = 0
    if handle is None:
        return
    try:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


def _parse_rollout_file(
    file_path: Path,
    mtime_ns: int,
    size: int,
    tz_name: str,
    ingest_mode: IngestMode,
    verbose: bool,
    strict: bool,
    error_sample_limit: int,
) -> ParsedRolloutFile:
    tz = ZoneInfo(tz_name)
    parsed_file = ParsedRolloutFile(file_path=file_path, mtime_ns=mtime_ns, size=size)
    context = RolloutContext()
    session_meta_saved = False
    turn_counters: Dict[str, int] = {}
    message_counters: Dict[str, int] = {}
    content_hash = hashlib.sha256()

    include_messages = ingest_mode == "full"
    include_tool_calls = ingest_mode in ("full", "redact_payloads")
    include_tool_payloads = ingest_mode == "full"
    lean_storage = ingest_mode != "full"

    try:
        with file_path.open("rb") as handle:
            for line_number, raw_bytes in enumerate(handle, start=1):
                content_hash.update(raw_bytes)
                try:
                    raw = raw_bytes.decode("utf-8").strip()
                except UnicodeDecodeError as exc:
                    _record_ingest_error(
                        parsed_file,
                        file_path,
                        line_number,
                        None,
                        exc,
                        "Decode error",
                        error_sample_limit,
                        verbose,
                        strict,
                    )
                    continue
                if not raw:
                    continue
                parsed_file.lines += 1
                try:
                    parsed, context = parse_rollout_line(
                        raw,
                        context,
                        tz,
                        include_messages=include_messages,
                        include_tool_calls=include_tool_calls,
                        include_tool_payloads=include_tool_payloads,
                    )
                except Exception as exc:
                    _record_ingest_error(
                        parsed_file,
                        file_path,
                        line_number,
                        raw,
                        exc,
                        "Parse error",
                        error_sample_limit,
                        verbose,
                        strict,
                    )
                    continue
                if parsed is None:
                    continue

                if parsed.session_meta is not None and not session_meta_saved:
                    session_meta_saved = True
                    session = parsed.session_meta
                    if session.session_id:
                        parsed_file.sessions.append(
                            SessionMeta(
                                session_id=session.session_id,
                                session_timestamp=session.session_timestamp_local.isoformat()
                                if session.session_timestamp_local
                                else None,
                                session_timestamp_utc=session.session_timestamp_utc.isoformat()
                                if session.session_timestamp_utc
                                else None,
                                cwd=session.cwd,
                                originator=session.originator,
                                cli_version=session.cli_version,
                                source=session.source,
                                model_provider=session.model_provider,
                                git_commit_hash=session.git_commit_hash,
                                git_branch=session.git_branch,
                                git_repository_url=session.git_repository_url,
                                captured_at=session.captured_at_local.isoformat(),
                                captured_at_utc=session.captured_at_utc.isoformat(),
                                rollout_source=str(file_path),
                            )
                        )

                if parsed.turn_context is not None:
                    turn = parsed.turn_context
                    turn_key = context.session_id or f"file:{file_path}"
                    turn_index = turn_counters.get(turn_key, 0) + 1
                    turn_counters[turn_key] = turn_index
                    parsed_file.turns.append(
                        TurnContext(
                            captured_at=turn.captured_at_local.isoformat(),
                            captured_at_utc=turn.captured_at_utc.isoformat(),
                            session_id=context.session_id,
                            turn_index=turn_index,
                            model=turn.model,
                            cwd=turn.cwd,
                            approval_policy=turn.approval_policy,
                            sandbox_policy_type=turn.sandbox_policy_type,
                            sandbox_network_access=turn.sandbox_network_access,
                            sandbox_writable_roots=turn.sandbox_writable_roots,
                            sandbox_exclude_tmpdir_env_var=turn.sandbox_exclude_tmpdir_env_var,
                            sandbox_exclude_slash_tmp=turn.sandbox_exclude_slash_tmp,
                            truncation_policy_mode=turn.truncation_policy_mode,
                            truncation_policy_limit=turn.truncation_policy_limit,
                            reasoning_effort=turn.reasoning_effort,
                            reasoning_summary=turn.reasoning_summary,
                            has_base_instructions=turn.has_base_instructions,
                            has_user_instructions=turn.has_user_instructions,
                            has_developer_instructions=turn.has_developer_instructions,
                            has_final_output_json_schema=turn.has_final_output_json_schema,
                            source=str(file_path),
                        )
                    )

                if parsed.token_count is not None:
                    token_count = parsed.token_count
                    parsed_file.events.append(
                        UsageEvent(
                            captured_at=token_count.captured_at_local.isoformat(),
                            captured_at_utc=token_count.captured_at_utc.isoformat(),
                            event_type="token_count",
                            total_tokens=token_count.tokens.get("total_tokens"),
                            input_tokens=token_count.tokens.get("input_tokens"),
                            cached_input_tokens=token_count.tokens.get(
                                "cached_input_tokens"
                            ),
                            output_tokens=token_count.tokens.get("output_tokens"),
                            reasoning_output_tokens=token_count.tokens.get(
                                "reasoning_output_tokens"
                            ),
                            lifetime_total_tokens=token_count.lifetime_tokens.get(
                                "total_tokens"
                            ),
                            lifetime_input_tokens=token_count.lifetime_tokens.get(
                                "input_tokens"
                            ),
                            lifetime_cached_input_tokens=token_count.lifetime_tokens.get(
                                "cached_input_tokens"
                            ),
                            lifetime_output_tokens=token_count.lifetime_tokens.get(
                                "output_tokens"
                            ),
                            lifetime_reasoning_output_tokens=token_count.lifetime_tokens.get(
                                "reasoning_output_tokens"
                            ),
                            context_used=token_count.context_used,
                            context_total=token_count.context_total,
                            context_percent_left=token_count.context_percent_left,
                            limit_5h_percent_left=token_count.limit_5h_percent_left,
                            limit_5h_resets_at=token_count.limit_5h_resets_at,
                            limit_weekly_percent_left=token_count.limit_weekly_percent_left,
                            limit_weekly_resets_at=token_count.limit_weekly_resets_at,
                            limit_5h_used_percent=token_count.limit_5h_used_percent,
                            limit_5h_window_minutes=token_count.limit_5h_window_minutes,
                            limit_5h_resets_at_seconds=token_count.limit_5h_resets_at_seconds,
                            limit_weekly_used_percent=token_count.limit_weekly_used_percent,
                            limit_weekly_window_minutes=token_count.limit_weekly_window_minutes,
                            limit_weekly_resets_at_seconds=token_count.limit_weekly_resets_at_seconds,
                            rate_limit_has_credits=token_count.rate_limit_has_credits,
                            rate_limit_unlimited=token_count.rate_limit_unlimited,
                            rate_limit_balance=token_count.rate_limit_balance,
                            rate_limit_plan_type=token_count.rate_limit_plan_type,
                            model=context.model,
                            directory=context.directory,
                            session_id=context.session_id,
                            codex_version=context.codex_version,
                            source=str(file_path),
                        )
                    )

                if parsed.event_marker is not None:
                    marker = parsed.event_marker
                    parsed_file.events.append(
                        UsageEvent(
                            captured_at=marker.captured_at_local.isoformat(),
                            captured_at_utc=marker.captured_at_utc.isoformat(),
                            event_type=marker.event_type,
                            model=context.model,
                            directory=context.directory,
                            session_id=context.session_id,
                            codex_version=context.codex_version,
                            source=str(file_path),
                        )
                    )

                turn_key = context.session_id or f"file:{file_path}"
                turn_index = turn_counters.get(turn_key)
                if parsed.activity_events:
                    for activity in parsed.activity_events:
                        if activity.count <= 0:
                            continue
                        if not _should_store_activity_event(
                            activity.event_type, ingest_mode
                        ):
                            continue
                        parsed_file.activity.append(
                            ActivityEvent(
                                captured_at=activity.captured_at_local.isoformat(),
                                captured_at_utc=activity.captured_at_utc.isoformat(),
                                event_type=activity.event_type,
                                event_name=activity.event_name,
                                count=activity.count,
                                session_id=context.session_id,
                                turn_index=turn_index,
                                source=str(file_path),
                            )
                        )

                if parsed.messages and include_messages:
                    for message in parsed.messages:
                        message_key = context.session_id or f"file:{file_path}"
                        ordinal = message_counters.get(message_key, 0)
                        message_counters[message_key] = ordinal + 1
                        parsed_file.messages.append(
                            MessageEvent(
                                captured_at=message.captured_at_local.isoformat(),
                                captured_at_utc=message.captured_at_utc.isoformat(),
                                role=message.role,
                                message_type=message.message_type,
                                message=message.message,
                                session_id=context.session_id,
                                turn_index=turn_index,
                                source=str(file_path),
                                ordinal=ordinal,
                                source_line=line_number,
                            )
                        )

                if parsed.tool_calls and include_tool_calls:
                    for tool_call in parsed.tool_calls:
                        if lean_storage and tool_call.tool_type in LEAN_DROPPED_TOOL_TYPES:
                            continue
                        input_text, input_length, input_truncated = (
                            _payload_preview(tool_call.input_text)
                            if include_tool_payloads
                            else (None, None, False)
                        )
                        output_text, output_length, output_truncated = (
                            _payload_preview(tool_call.output_text)
                            if include_tool_payloads
                            else (None, None, False)
                        )
                        command, command_length, command_truncated = (
                            _payload_preview(tool_call.command, MAX_TOOL_COMMAND_CHARS)
                            if include_tool_payloads
                            else (None, None, False)
                        )
                        parsed_file.tool_calls.append(
                            ToolCallEvent(
                                captured_at=tool_call.captured_at_local.isoformat(),
                                captured_at_utc=tool_call.captured_at_utc.isoformat(),
                                tool_type=tool_call.tool_type,
                                tool_name=tool_call.tool_name,
                                call_id=None if lean_storage else tool_call.call_id,
                                status=tool_call.status,
                                input_text=input_text,
                                output_text=output_text,
                                command=command,
                                session_id=context.session_id,
                                turn_index=turn_index,
                                source=str(file_path),
                                input_length=input_length,
                                output_length=output_length,
                                payload_truncated=(
                                    input_truncated
                                    or output_truncated
                                    or command_truncated
                                    or bool(command_length and command_length > MAX_TOOL_COMMAND_CHARS)
                                ),
                            )
                        )
    except OSError as exc:
        _record_ingest_error(
            parsed_file,
            file_path,
            None,
            None,
            exc,
            "Read error",
            error_sample_limit,
            verbose,
            strict,
        )
    parsed_file.content_hash = content_hash.hexdigest()
    return parsed_file


def _write_parsed_rollout(
    store: UsageStore,
    parsed: ParsedRolloutFile,
    cold_bulk: bool,
) -> int:
    rows = 0
    with store.transaction():
        source = str(parsed.file_path)
        if not cold_bulk:
            store.delete_events_for_source(source, commit=False)
            store.delete_turns_for_source(source, commit=False)
            store.delete_activity_events_for_source(source, commit=False)
            store.delete_content_for_source(source, commit=False)
        for session in parsed.sessions:
            store.upsert_session(session, commit=False)
        rows += store.insert_events_bulk(parsed.events, commit=False)
        store.insert_turns_bulk(parsed.turns, commit=False)
        rows += store.insert_activity_events_bulk(parsed.activity, commit=False)
        rows += store.insert_messages_bulk(parsed.messages, commit=False)
        rows += store.insert_tool_calls_bulk(parsed.tool_calls, commit=False)
        store.mark_file_ingested(
            source,
            parsed.mtime_ns,
            parsed.size,
            content_hash=parsed.content_hash,
            commit=False,
        )
    return rows


def _ingest_rollouts_locked(
    path: Path,
    store: UsageStore,
    start: Optional[datetime],
    end: Optional[datetime],
    tz: ZoneInfo,
    progress_callback: Optional[
        Callable[[IngestStats, int, int, Optional[Path]], None]
    ] = None,
    verbose: bool = False,
    strict: bool = False,
    ingest_mode: "IngestMode" = "full",
    error_sample_limit: int = 5,
    workers: Optional[int] = None,
) -> IngestStats:
    store.ensure_ingest_version()
    stats = IngestStats()
    stats.started_at = time.time()
    files = list(_select_rollout_files(path, start, end, tz))
    stats.files_total = len(files)
    progress = ProgressPrinter(stats.files_total)

    def _update_timing(current: int, file_path: Optional[Path]) -> None:
        now_ts = time.time()
        if stats.started_at is None:
            stats.started_at = now_ts
        stats.updated_at = now_ts
        stats.current_file = str(file_path) if file_path else None

    def _completed_count() -> int:
        return stats.files_parsed + stats.files_skipped

    def _merge_errors(parsed: ParsedRolloutFile) -> None:
        stats.errors += parsed.errors
        remaining = max(error_sample_limit - len(stats.error_samples), 0)
        if remaining:
            stats.error_samples.extend(parsed.error_samples[:remaining])

    def _record_worker_error(file_path: Path, error: Exception) -> None:
        stats.errors += 1
        if verbose:
            sys.stderr.write(f"Ingestion worker failed for {file_path}: {error}\n")
            sys.stderr.flush()
        elif len(stats.error_samples) < error_sample_limit:
            stats.error_samples.append(
                {
                    "file": str(file_path),
                    "line": None,
                    "error": f"Ingestion worker failed: {error}",
                    "snippet": None,
                }
            )

    def _consume_parsed(parsed: ParsedRolloutFile, cold_bulk: bool) -> None:
        stats.lines += parsed.lines
        _merge_errors(parsed)
        stats.events += _write_parsed_rollout(store, parsed, cold_bulk=cold_bulk)
        stats.files_parsed += 1
        _update_timing(_completed_count(), parsed.file_path)
        progress.update(_completed_count(), stats, parsed.file_path)
        if progress_callback is not None:
            progress_callback(stats, _completed_count(), stats.files_total, parsed.file_path)

    if progress_callback is not None:
        _update_timing(0, None)
        progress_callback(stats, 0, stats.files_total, None)

    files_to_parse: list[tuple[Path, int, int]] = []
    for file_path, mtime_ns, size, _ in files:
        needs_ingest = store.file_needs_ingest(str(file_path), mtime_ns, size)
        if not needs_ingest:
            stats.files_skipped += 1
            _update_timing(_completed_count(), file_path)
            progress.update(_completed_count(), stats, file_path)
            if progress_callback is not None:
                progress_callback(stats, _completed_count(), stats.files_total, file_path)
            continue
        files_to_parse.append((file_path, mtime_ns, size))

    include_messages = ingest_mode == "full"
    cold_bulk = (
        bool(files_to_parse)
        and stats.files_skipped == 0
        and start is None
        and end is None
        and store.ingestion_file_count() == 0
    )
    worker_count = min(_resolve_ingest_workers(workers), len(files_to_parse) or 1)
    bulk_prepared = False
    failure: Optional[BaseException] = None

    try:
        if cold_bulk:
            store.prepare_bulk_load(include_messages=include_messages)
            bulk_prepared = True

        if files_to_parse:
            if worker_count <= 1:
                for file_path, mtime_ns, size in files_to_parse:
                    try:
                        parsed = _parse_rollout_file(
                            file_path,
                            mtime_ns,
                            size,
                            tz.key,
                            ingest_mode,
                            verbose,
                            strict,
                            error_sample_limit,
                        )
                        _consume_parsed(parsed, cold_bulk=cold_bulk)
                    except Exception as exc:
                        _record_worker_error(file_path, exc)
                        failure = exc
                        break
            else:
                with ThreadPoolExecutor(max_workers=worker_count) as executor:
                    futures = {
                        executor.submit(
                            _parse_rollout_file,
                            file_path,
                            mtime_ns,
                            size,
                            tz.key,
                            ingest_mode,
                            verbose,
                            strict,
                            error_sample_limit,
                        ): file_path
                        for file_path, mtime_ns, size in files_to_parse
                    }
                    for future in as_completed(futures):
                        file_path = futures[future]
                        try:
                            parsed = future.result()
                            _consume_parsed(parsed, cold_bulk=cold_bulk)
                        except Exception as exc:
                            _record_worker_error(file_path, exc)
                            failure = exc
                            break
        if failure is not None:
            raise failure
    finally:
        if bulk_prepared:
            store.finish_bulk_load(include_messages=include_messages)

    progress.finish()
    if progress_callback is not None:
        _update_timing(stats.files_total, None)
        progress_callback(stats, stats.files_total, stats.files_total, None)
    if stats.errors and not verbose and stats.error_samples:
        sys.stderr.write(
            f"Encountered {stats.errors} ingestion errors. "
            f"Showing {len(stats.error_samples)} samples:\n"
        )
        for sample in stats.error_samples:
            location = sample.get("file", "<unknown>")
            line = sample.get("line")
            if line:
                location = f"{location}:{line}"
            message = sample.get("error") or "Unknown error"
            snippet = sample.get("snippet")
            sys.stderr.write(f"- {location}: {message}\n")
            if snippet:
                sys.stderr.write(f"  {snippet}\n")
        sys.stderr.flush()
    if stats.updated_at is None:
        stats.updated_at = time.time()
    try:
        def _format_ts(value: Optional[float]) -> Optional[str]:
            if value is None:
                return None
            return datetime.fromtimestamp(value, tz=ZoneInfo("UTC")).isoformat()

        payload = {
            "range": {
                "from": start.isoformat() if start else None,
                "to": end.isoformat() if end else None,
            },
            "files_total": stats.files_total,
            "files_parsed": stats.files_parsed,
            "files_skipped": stats.files_skipped,
            "lines": stats.lines,
            "events": stats.events,
            "errors": stats.errors,
            "started_at": _format_ts(stats.started_at),
            "updated_at": _format_ts(stats.updated_at),
            "error_samples": stats.error_samples,
        }
        store.set_meta("last_ingest_stats", json.dumps(payload, ensure_ascii=True))
    except Exception:
        pass
    return stats


def ingest_rollouts(
    path: Path,
    store: UsageStore,
    start: Optional[datetime],
    end: Optional[datetime],
    tz: ZoneInfo,
    progress_callback: Optional[
        Callable[[IngestStats, int, int, Optional[Path]], None]
    ] = None,
    verbose: bool = False,
    strict: bool = False,
    ingest_mode: "IngestMode" = "full",
    error_sample_limit: int = 5,
    workers: Optional[int] = None,
) -> IngestStats:
    lock_handle = _acquire_ingestion_lock(store.path)
    try:
        return _ingest_rollouts_locked(
            path,
            store,
            start,
            end,
            tz,
            progress_callback=progress_callback,
            verbose=verbose,
            strict=strict,
            ingest_mode=ingest_mode,
            error_sample_limit=error_sample_limit,
            workers=workers,
        )
    finally:
        _release_ingestion_lock(lock_handle)


def ingest_cli_output(
    log_path: Path,
    store: UsageStore,
    tz: ZoneInfo,
) -> CliLogStats:
    stats = CliLogStats()
    capture = StatusCapture()
    stat_info = None
    content_hash: Optional[str] = None
    pending_events: list[UsageEvent] = []
    if log_path.name != "-":
        try:
            stat_info = log_path.stat()
        except OSError:
            return stats
        if not store.file_needs_ingest(
            str(log_path), stat_info.st_mtime_ns, stat_info.st_size
        ):
            return stats
        store.delete_events_for_source(str(log_path))

    def _handle_snapshot(snapshot) -> None:
        nonlocal stats
        captured_at = datetime.now(tz)
        limit_5h_percent_left, limit_5h_resets_at, limit_weekly_percent_left, limit_weekly_resets_at = map_limits(snapshot)
        token_usage = snapshot.token_usage or {}
        context_window = snapshot.context_window or {}
        event = UsageEvent(
            captured_at=captured_at.isoformat(),
            captured_at_utc=captured_at.astimezone(ZoneInfo("UTC")).isoformat(),
            event_type="status_snapshot",
            total_tokens=token_usage.get("total_tokens"),
            input_tokens=token_usage.get("input_tokens"),
            cached_input_tokens=None,
            output_tokens=token_usage.get("output_tokens"),
            reasoning_output_tokens=None,
            context_used=context_window.get("used_tokens"),
            context_total=context_window.get("total_tokens"),
            context_percent_left=context_window.get("percent_left"),
            limit_5h_percent_left=limit_5h_percent_left,
            limit_5h_resets_at=limit_5h_resets_at,
            limit_weekly_percent_left=limit_weekly_percent_left,
            limit_weekly_resets_at=limit_weekly_resets_at,
            model=snapshot.model,
            directory=snapshot.directory,
            session_id=snapshot.session_id,
            codex_version=snapshot.codex_version,
            source=str(log_path),
        )
        pending_events.append(event)
        stats.status_snapshots += 1

    def _handle_usage(tokens: Dict[str, int]) -> None:
        nonlocal stats
        captured_at = datetime.now(tz)
        event = UsageEvent(
            captured_at=captured_at.isoformat(),
            captured_at_utc=captured_at.astimezone(ZoneInfo("UTC")).isoformat(),
            event_type="usage_line",
            total_tokens=tokens.get("total_tokens"),
            input_tokens=tokens.get("input_tokens"),
            cached_input_tokens=tokens.get("cached_input_tokens"),
            output_tokens=tokens.get("output_tokens"),
            reasoning_output_tokens=tokens.get("reasoning_output_tokens"),
            source=str(log_path),
        )
        pending_events.append(event)
        stats.usage_lines += 1

    try:
        if log_path.name == "-":
            handle = sys.stdin
        else:
            handle = log_path.open("r", encoding="utf-8")
        with handle:
            for raw in handle:
                stats.lines += 1
                usage = parse_token_usage_line(raw)
                if usage:
                    _handle_usage(usage)
                snapshot = capture.feed_line(raw)
                if snapshot:
                    _handle_snapshot(snapshot)
    except OSError:
        stats.lines = 0
        return stats
    stats.events += store.insert_events_bulk(pending_events)
    if stat_info is not None:
        if content_hash is None:
            try:
                content_hash = compute_file_hash(log_path)
            except OSError:
                content_hash = None
        store.mark_file_ingested(
            str(log_path),
            stat_info.st_mtime_ns,
            stat_info.st_size,
            content_hash=content_hash,
        )
    return stats


def _load_usage_events(store: UsageStore) -> Iterable[Dict[str, object]]:
    return [dict(row) for row in store.iter_usage_events()]


def _to_utc_iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo("UTC"))
    return value.astimezone(ZoneInfo("UTC")).isoformat()


def _load_usage_events_for_range(
    store: UsageStore,
    start: Optional[datetime],
    end: Optional[datetime],
) -> list[Dict[str, object]]:
    return [
        dict(row)
        for row in store.iter_usage_events(
            start=_to_utc_iso(start),
            end=_to_utc_iso(end),
        )
    ]


def _filter_range(
    events: Iterable[Dict[str, object]],
    start: Optional[datetime],
    end: Optional[datetime],
    tz: ZoneInfo,
) -> Iterable[Dict[str, object]]:
    filtered = []
    for event in events:
        captured_raw = event.get("captured_at_utc") or event.get("captured_at")
        if not captured_raw:
            continue
        captured_at = parse_datetime(str(captured_raw))
        local_dt = to_local(captured_at, tz)
        if start and local_dt < start:
            continue
        if end and local_dt > end:
            continue
        filtered.append(event)
    return filtered


def _parse_weekly_reset(value: str) -> Optional[Tuple[int, dt_time]]:
    parts = value.strip().lower().split()
    if len(parts) != 2:
        return None
    day_part, time_part = parts
    weekday_map = {
        "mon": 0,
        "tue": 1,
        "wed": 2,
        "thu": 3,
        "fri": 4,
        "sat": 5,
        "sun": 6,
    }
    weekday = weekday_map.get(day_part[:3])
    if weekday is None:
        return None
    try:
        hour, minute = time_part.split(":")
        reset_time = dt_time(hour=int(hour), minute=int(minute))
    except ValueError:
        return None
    return weekday, reset_time


def _weekly_reset_rule() -> Tuple[int, dt_time]:
    value = os.getenv("CODEX_USAGE_WEEKLY_RESET")
    if value:
        parsed = _parse_weekly_reset(value)
        if parsed is not None:
            return parsed
    return 4, dt_time(hour=9, minute=15)


def _last_completed_week(now: datetime) -> Tuple[datetime, datetime]:
    weekday, reset_time = _weekly_reset_rule()
    anchor = now.replace(
        hour=reset_time.hour,
        minute=reset_time.minute,
        second=0,
        microsecond=0,
    )
    days_since = (now.weekday() - weekday) % 7
    last_reset = anchor - timedelta(days=days_since)
    if last_reset > now:
        last_reset -= timedelta(days=7)
    week_start = last_reset - timedelta(days=7)
    week_end = last_reset
    return week_start, week_end


def _estimate_weekly_quota(
    store: UsageStore,
    now: datetime,
    pricing: Optional[PricingConfig] = None,
    tz: ZoneInfo = ZoneInfo(DEFAULT_TIMEZONE),
) -> Optional[Dict[str, object]]:
    week_start, week_end = _last_completed_week(now)
    events = _load_usage_events_for_range(store, week_start, week_end)
    if not events:
        return None

    total_tokens = sum(int(event.get("total_tokens") or 0) for event in events)
    pricing = pricing if pricing is not None else default_pricing()
    total_cost, _, _, _ = compute_costs(events, pricing)
    if total_tokens <= 0:
        return None

    used_percent_max = None
    for event in events:
        percent_left = event.get("limit_weekly_percent_left")
        if percent_left is None:
            continue
        used_percent = 100.0 - float(percent_left)
        used_percent_max = (
            used_percent
            if used_percent_max is None
            else max(used_percent_max, used_percent)
        )

    scale = 1.0
    if used_percent_max is not None and used_percent_max > 0:
        scale = 100.0 / used_percent_max

    quota_tokens = int(round(total_tokens * scale))
    quota_cost = total_cost * scale
    payload = {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "quota_tokens": quota_tokens,
        "quota_cost": quota_cost,
        "used_percent": used_percent_max,
        "observed_tokens": total_tokens,
        "observed_cost": total_cost,
        "computed_at": now.isoformat(),
    }
    store.upsert_weekly_quota(**payload)
    return payload


def _format_int(value: Optional[object]) -> str:
    return f"{int(value or 0):,}"


def _print_status(row: Dict[str, object]) -> None:
    print(f"Captured: {row.get('captured_at')}")
    if row.get("model"):
        print(f"Model: {row.get('model')}")
    if row.get("directory"):
        print(f"Directory: {row.get('directory')}")
    if row.get("session_id"):
        print(f"Session: {row.get('session_id')}")
    if row.get("codex_version"):
        print(f"Codex version: {row.get('codex_version')}")

    if row.get("total_tokens") is not None:
        print(
            "Token usage: total={total} input={input} cached={cached} output={output}".format(
                total=_format_int(row.get("total_tokens")),
                input=_format_int(row.get("input_tokens")),
                cached=_format_int(row.get("cached_input_tokens")),
                output=_format_int(row.get("output_tokens")),
            )
        )

    if row.get("context_total"):
        print(
            "Context window: {percent}% left ({used} used / {total})".format(
                percent=row.get("context_percent_left") or 0,
                used=_format_int(row.get("context_used")),
                total=_format_int(row.get("context_total")),
            )
        )

    if row.get("limit_5h_percent_left") is not None:
        resets = row.get("limit_5h_resets_at")
        reset_text = f" (resets {resets})" if resets else ""
        print(f"5h limit: {row.get('limit_5h_percent_left')}% left{reset_text}")

    if row.get("limit_weekly_percent_left") is not None:
        resets = row.get("limit_weekly_resets_at")
        reset_text = f" (resets {resets})" if resets else ""
        print(f"Weekly limit: {row.get('limit_weekly_percent_left')}% left{reset_text}")


def _profile_db(store: UsageStore) -> Dict[str, object]:
    conn = store.conn
    tables = [
        "events",
        "sessions",
        "turns",
        "activity_events",
        "tool_calls",
        "messages",
        "ingestion_files",
        "app_turns",
        "app_items",
        "weekly_quota_estimates",
    ]
    counts = {}
    for table in tables:
        try:
            row = conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()
        except Exception:
            continue
        counts[table] = int(row["count"] or 0)

    sizes = []
    try:
        for row in conn.execute(
            """
            SELECT name, SUM(pgsize) AS bytes
            FROM dbstat
            GROUP BY name
            ORDER BY bytes DESC
            LIMIT 25
            """
        ).fetchall():
            sizes.append({"name": row["name"], "bytes": int(row["bytes"] or 0)})
    except Exception:
        sizes = []

    ingestion = conn.execute(
        """
        SELECT COUNT(*) AS files,
               SUM(size) AS total_source_bytes,
               AVG(size) AS avg_source_bytes,
               MAX(size) AS max_source_bytes,
               SUM(CASE WHEN content_hash IS NULL THEN 1 ELSE 0 END) AS missing_hashes
        FROM ingestion_files
        """
    ).fetchone()
    event_types = [
        dict(row)
        for row in conn.execute(
            """
            SELECT event_type, COUNT(*) AS count
            FROM events
            GROUP BY event_type
            ORDER BY count DESC
            LIMIT 20
            """
        ).fetchall()
    ]
    tool_types = [
        dict(row)
        for row in conn.execute(
            """
            SELECT tool_type, COUNT(*) AS count
            FROM tool_calls
            GROUP BY tool_type
            ORDER BY count DESC
            LIMIT 20
            """
        ).fetchall()
    ]
    return {
        "path": str(store.path),
        "schema_version": store._get_meta("schema_version"),
        "ingest_version": store._get_meta("ingest_version"),
        "storage_profile_version": store._get_meta("storage_profile_version"),
        "counts": counts,
        "sizes": sizes,
        "ingestion": dict(ingestion) if ingestion else {},
        "event_types": event_types,
        "tool_types": tool_types,
    }


def _parse_cli_range(
    args: argparse.Namespace,
    tz: ZoneInfo,
    *,
    default_last: Optional[str] = None,
    default_today: bool = False,
) -> Tuple[Optional[datetime], Optional[datetime]]:
    now = datetime.now(tz)
    has_explicit_range = bool(args.today or args.last or args.from_date or args.to_date)
    if not has_explicit_range and default_today:
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start, now
    if not has_explicit_range and default_last:
        return parse_last(default_last, now)
    if args.today:
        if args.last or args.from_date or args.to_date:
            raise ValueError("--today cannot be combined with --last/--from/--to")
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start, now
    if args.last:
        if args.from_date or args.to_date:
            raise ValueError("--last cannot be combined with --from/--to")
        return parse_last(args.last, now)
    start = to_local(parse_datetime(args.from_date), tz) if args.from_date else None
    end = to_local(parse_datetime(args.to_date), tz) if args.to_date else None
    return start, end


def _parse_compare_ranges(
    args: argparse.Namespace,
    tz: ZoneInfo,
) -> Tuple[datetime, datetime, datetime, datetime]:
    current_start, current_end = _parse_cli_range(args, tz, default_today=True)
    if current_start is None or current_end is None:
        raise ValueError("compare requires a bounded current range")

    if bool(args.vs_from_date) != bool(args.vs_to_date):
        raise ValueError("--vs-from and --vs-to must be provided together")
    if args.vs_from_date and args.vs_to_date:
        baseline_start = to_local(parse_datetime(args.vs_from_date), tz)
        baseline_end = to_local(parse_datetime(args.vs_to_date), tz)
        return current_start, current_end, baseline_start, baseline_end

    if args.today or not (args.last or args.from_date or args.to_date):
        return (
            current_start,
            current_end,
            current_start - timedelta(days=1),
            current_end - timedelta(days=1),
        )

    duration = current_end - current_start
    return current_start, current_end, current_start - duration, current_start


def _format_money(value: object, currency_label: str) -> str:
    return f"{currency_label}{float(value or 0.0):,.4f}"


def _format_delta(value: object, percent: object = None) -> str:
    numeric = float(value or 0.0)
    sign = "+" if numeric > 0 else ""
    if percent is None:
        return f"{sign}{numeric:,.1f}"
    percent_value = float(percent)
    percent_sign = "+" if percent_value > 0 else ""
    return f"{sign}{numeric:,.1f} ({percent_sign}{percent_value:.1f}%)"


def _truncate(value: object, width: int) -> str:
    text = str(value or "")
    if len(text) <= width:
        return text
    return text[: max(width - 3, 0)] + "..."


def _directory_basename(value: object) -> str:
    text = str(value or "").rstrip("/")
    if not text:
        return ""
    return Path(text).name or text


def _print_insight(payload: Dict[str, object], currency_label: str) -> None:
    summary = payload["summary"]
    print("Insight")
    print(f"Range: {summary.get('start') or 'beginning'} -> {summary.get('end') or 'now'}")
    print(
        "Totals: "
        f"{_format_int(summary.get('total_tokens'))} tokens, "
        f"{_format_money(summary.get('estimated_cost'), currency_label)}, "
        f"{_format_int(summary.get('sessions'))} sessions, "
        f"{_format_int(summary.get('messages'))} messages, "
        f"{_format_int(summary.get('tool_calls'))} tools"
    )
    print(
        "Signals: "
        f"{_format_int(summary.get('tool_issue_signals'))} tool issues, "
        f"{_format_int(summary.get('compactions'))} compactions, "
        f"min context left {summary.get('min_context_percent_left') if summary.get('min_context_percent_left') is not None else 'n/a'}%"
    )
    _print_session_rows("Interesting sessions", payload["interesting_sessions"], currency_label)
    _print_session_rows("Top expensive sessions", payload["top_expensive_sessions"], currency_label)
    _print_named_rows("Top models", payload["top_models"], currency_label, cost=True)
    _print_named_rows("Top directories", payload["top_directories"], currency_label, cost=False)
    _print_tool_rows("Top tools", payload["top_tools"])


def _print_session_rows(title: str, rows: object, currency_label: str) -> None:
    rows = list(rows or [])
    print(f"\n{title}:")
    if not rows:
        print("  No sessions found.")
        return
    print("  Score  Cost       Tokens     Tools  Issues  Cmp  Last seen              Session       CWD")
    for row in rows:
        print(
            "  "
            f"{float(row.get('interesting_score') or 0.0):>5.1f}  "
            f"{_format_money(row.get('estimated_cost'), currency_label):>9}  "
            f"{_format_int(row.get('total_tokens')):>9}  "
            f"{_format_int(row.get('tool_calls')):>5}  "
            f"{_format_int(row.get('tool_issue_signals')):>6}  "
            f"{_format_int(row.get('compactions')):>3}  "
            f"{_truncate(row.get('last_seen'), 20):<20}  "
            f"{_truncate(row.get('session_id'), 12):<12}  "
            f"{_truncate(_directory_basename(row.get('cwd')), 44)}"
        )


def _print_named_rows(
    title: str,
    rows: object,
    currency_label: str,
    *,
    cost: bool,
) -> None:
    rows = list(rows or [])
    print(f"\n{title}:")
    if not rows:
        print("  No rows found.")
        return
    if cost:
        print("  Name                                      Tokens     Cost")
    else:
        print("  Name                                      Tokens")
    for row in rows:
        name = row.get("name")
        if title.lower().endswith("directories"):
            name = _directory_basename(name)
        line = (
            f"  {_truncate(name, 40):<40}  "
            f"{_format_int(row.get('total_tokens')):>9}"
        )
        if cost:
            line += f"  {_format_money(row.get('estimated_cost'), currency_label):>9}"
        print(line)


def _print_tool_rows(title: str, rows: object) -> None:
    rows = list(rows or [])
    print(f"\n{title}:")
    if not rows:
        print("  No tools found.")
        return
    print("  Tool                                      Calls  Issues  Trunc")
    for row in rows:
        print(
            f"  {_truncate(row.get('name'), 40):<40}  "
            f"{_format_int(row.get('count')):>5}  "
            f"{_format_int(row.get('issue_signals')):>6}  "
            f"{_format_int(row.get('truncated')):>5}"
        )


def _print_compare(payload: Dict[str, object], currency_label: str) -> None:
    current = payload["current"]
    baseline = payload["baseline"]
    print("Compare")
    print(f"Current:  {current.get('start')} -> {current.get('end')}")
    print(f"Baseline: {baseline.get('start')} -> {baseline.get('end')}")
    print("\nDeltas:")
    labels = [
        ("estimated_cost", "Cost", True),
        ("total_tokens", "Tokens", False),
        ("sessions", "Sessions", False),
        ("messages", "Messages", False),
        ("tool_calls", "Tool calls", False),
        ("tool_issue_signals", "Tool issues", False),
        ("compactions", "Compactions", False),
    ]
    for key, label, is_money in labels:
        delta = payload["deltas"][key]
        current_value = delta["current"]
        baseline_value = delta["baseline"]
        delta_value = delta["delta"]
        percent = delta["percent"]
        if is_money:
            current_text = _format_money(current_value, currency_label)
            baseline_text = _format_money(baseline_value, currency_label)
            delta_text = _format_delta(delta_value, percent)
        else:
            current_text = _format_int(current_value)
            baseline_text = _format_int(baseline_value)
            delta_text = _format_delta(delta_value, percent)
        print(f"  {label:<14} {current_text:>12} vs {baseline_text:>12}  {delta_text}")
    _print_session_rows("Current interesting sessions", payload["current_top_sessions"], currency_label)
    _print_named_rows("Current top models", payload["current_top_models"], currency_label, cost=True)
    _print_tool_rows("Current top tools", payload["current_top_tools"])


def _print_doctor(payload: Dict[str, object]) -> None:
    summary = payload["summary"]
    print(f"Doctor: {payload['path']}")
    print(
        f"Summary: {summary.get('pass', 0)} pass, "
        f"{summary.get('warn', 0)} warn, {summary.get('fail', 0)} fail"
    )
    for check in payload["checks"]:
        print(f"[{check['status']}] {check['name']}: {check['detail']}")
        if "counts" in check:
            counts = check["counts"]
            print(
                "  "
                + ", ".join(f"{name}={count:,}" for name, count in counts.items())
            )
        if "milliseconds" in check:
            timings = check["milliseconds"]
            print(
                "  "
                + ", ".join(
                    f"{name}={value:.1f}ms" if value >= 0 else f"{name}=unavailable"
                    for name, value in timings.items()
                )
            )


def _print_pricing(payload: Dict[str, object]) -> None:
    print(f"Pricing config: {payload['config_path']}")
    print(
        f"Currency: {payload['currency_label']}  "
        f"Unit: {payload['unit']}  Per unit: {_format_int(payload['per_unit'])}"
    )
    print("\nModel                         Source      Input     Cached     Output    Events      Tokens       Est. cost")
    for row in payload["models"]:
        cost = row.get("estimated_cost")
        cost_text = (
            _format_money(cost, str(payload["currency_label"]))
            if cost is not None
            else "unpriced"
        )
        input_text = (
            f"{float(row['input_rate']):.6g}"
            if row.get("input_rate") is not None
            else "-"
        )
        cached_text = (
            f"{float(row['cached_input_rate']):.6g}"
            if row.get("cached_input_rate") is not None
            else "-"
        )
        output_text = (
            f"{float(row['output_rate']):.6g}"
            if row.get("output_rate") is not None
            else "-"
        )
        print(
            f"{_truncate(row.get('model'), 29):<29} "
            f"{str(row.get('source')):<10} "
            f"{input_text:>8} "
            f"{cached_text:>10} "
            f"{output_text:>10} "
            f"{_format_int(row.get('usage_events')):>9} "
            f"{_format_int(row.get('total_tokens')):>11} "
            f"{cost_text:>14}"
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codex-track")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_ingest_args(target: argparse.ArgumentParser) -> None:
        target.add_argument(
            "--verbose",
            action="store_true",
            help="Print rollout parse errors during ingestion",
        )
        target.add_argument(
            "--strict",
            action="store_true",
            help="Stop ingestion on the first rollout parse error",
        )
        target.add_argument(
            "--no-content",
            "--redact",
            action="store_true",
            help="Do not store any content messages or tool calls",
        )
        target.add_argument(
            "--no-payloads",
            action="store_true",
            help="Store tool call metadata but redact message and tool payloads",
        )
        target.add_argument(
            "--with-payloads",
            action="store_true",
            help="Store messages and capped tool payload previews (default)",
        )
        target.add_argument(
            "--workers",
            type=int,
            default=None,
            help=(
                "Number of rollout parser workers "
                f"(default {DEFAULT_INGEST_WORKERS})"
            ),
        )

    def add_range_args(target: argparse.ArgumentParser, *, help_prefix: str = "range") -> None:
        target.add_argument(
            "--last",
            type=str,
            default=None,
            help=f"Relative {help_prefix} like 7d, 12h, 1m, 30min, or total",
        )
        target.add_argument(
            "--today",
            action="store_true",
            help=f"Use today's {help_prefix} (midnight to now, local timezone)",
        )
        target.add_argument("--from", dest="from_date", type=str, default=None)
        target.add_argument("--to", dest="to_date", type=str, default=None)
        target.add_argument(
            "--timezone",
            type=str,
            default=None,
            help=f"Timezone for {help_prefix}s (IANA name, default {DEFAULT_TIMEZONE})",
        )

    report_parser = subparsers.add_parser("report", help="Aggregate usage reports")
    report_parser.add_argument("--db", type=Path, default=None)
    report_parser.add_argument("--rollouts", type=Path, default=None)
    add_ingest_args(report_parser)
    report_parser.add_argument(
        "--last",
        type=str,
        default=None,
        help="Relative range like 7d, 12h, 1m (month), 30min, or total",
    )
    report_parser.add_argument(
        "--today",
        action="store_true",
        help="Use today's usage (midnight to now, local timezone)",
    )
    report_parser.add_argument("--from", dest="from_date", type=str, default=None)
    report_parser.add_argument("--to", dest="to_date", type=str, default=None)
    report_parser.add_argument(
        "--timezone",
        type=str,
        default=None,
        help=f"Timezone for report ranges (IANA name, default {DEFAULT_TIMEZONE})",
    )
    report_parser.add_argument(
        "--group", choices=["day", "week", "month"], default="day"
    )
    report_parser.add_argument(
        "--by", choices=["model", "directory", "session"], default=None
    )
    report_parser.add_argument(
        "--format", choices=["table", "json", "csv"], default="table"
    )

    export_parser = subparsers.add_parser("export", help="Export raw events")
    export_parser.add_argument("--db", type=Path, default=None)
    export_parser.add_argument("--rollouts", type=Path, default=None)
    add_ingest_args(export_parser)
    export_parser.add_argument("--format", choices=["json", "csv"], default="json")
    export_parser.add_argument("--out", type=Path, required=True)

    status_parser = subparsers.add_parser(
        "status", help="Show latest captured usage snapshot"
    )
    status_parser.add_argument("--db", type=Path, default=None)
    status_parser.add_argument("--rollouts", type=Path, default=None)
    add_ingest_args(status_parser)

    profile_parser = subparsers.add_parser(
        "profile",
        help="Inspect DB size, row counts, and ingestion/index profile",
    )
    profile_parser.add_argument("--db", type=Path, default=None)
    profile_parser.add_argument("--format", choices=["json", "table"], default="table")

    def add_pricing_list_args(target: argparse.ArgumentParser) -> None:
        target.add_argument("--db", type=Path, default=None)
        target.add_argument("--rollouts", type=Path, default=None)
        add_ingest_args(target)
        add_range_args(target, help_prefix="pricing usage range")
        target.add_argument(
            "--used-only",
            action="store_true",
            help="Only show models seen in tracked usage",
        )
        target.add_argument("--json", dest="json_output", action="store_true")

    pricing_parser = subparsers.add_parser(
        "pricing",
        help="Show and manage model cost rates used for cost tracking",
    )
    add_pricing_list_args(pricing_parser)
    pricing_subparsers = pricing_parser.add_subparsers(
        dest="pricing_command",
        required=False,
    )
    pricing_list_parser = pricing_subparsers.add_parser(
        "list",
        help="Show effective model pricing and tracked cost totals",
    )
    add_pricing_list_args(pricing_list_parser)

    pricing_set_parser = pricing_subparsers.add_parser(
        "set",
        help="Add or update a model pricing override",
    )
    pricing_set_parser.add_argument("model")
    pricing_set_parser.add_argument("--db", type=Path, default=None)
    pricing_set_parser.add_argument("--input-rate", type=float, default=None)
    pricing_set_parser.add_argument("--cached-input-rate", type=float, default=None)
    pricing_set_parser.add_argument("--output-rate", type=float, default=None)
    pricing_set_parser.add_argument("--per-unit", type=int, default=None)
    pricing_set_parser.add_argument("--unit", type=str, default=None)
    pricing_set_parser.add_argument("--currency-label", type=str, default=None)
    pricing_set_parser.add_argument("--json", dest="json_output", action="store_true")

    pricing_remove_parser = pricing_subparsers.add_parser(
        "remove",
        help="Remove a model pricing override and fall back to defaults if available",
    )
    pricing_remove_parser.add_argument("model")
    pricing_remove_parser.add_argument("--db", type=Path, default=None)
    pricing_remove_parser.add_argument("--json", dest="json_output", action="store_true")

    pricing_path_parser = pricing_subparsers.add_parser(
        "path",
        help="Print the pricing config path",
    )
    pricing_path_parser.add_argument("--db", type=Path, default=None)

    insight_parser = subparsers.add_parser(
        "insight",
        help="Show high-level usage, cost, session, and tool signals",
    )
    insight_parser.add_argument("--db", type=Path, default=None)
    insight_parser.add_argument("--rollouts", type=Path, default=None)
    add_ingest_args(insight_parser)
    add_range_args(insight_parser, help_prefix="insight range")
    insight_parser.add_argument("--limit", type=int, default=10)
    insight_parser.add_argument("--json", dest="json_output", action="store_true")

    sessions_parser = subparsers.add_parser(
        "sessions",
        help="List recent sessions or rank interesting sessions",
    )
    sessions_parser.add_argument("--db", type=Path, default=None)
    sessions_parser.add_argument("--rollouts", type=Path, default=None)
    add_ingest_args(sessions_parser)
    add_range_args(sessions_parser, help_prefix="session range")
    sessions_parser.add_argument("--interesting", action="store_true")
    sessions_parser.add_argument("--limit", type=int, default=20)
    sessions_parser.add_argument("--cwd", type=str, default=None)
    sessions_parser.add_argument("--model", type=str, default=None)
    sessions_parser.add_argument("--search", type=str, default=None)
    sessions_parser.add_argument("--json", dest="json_output", action="store_true")

    doctor_parser = subparsers.add_parser(
        "doctor",
        help="Check storage, FTS, indexes, row counts, and query timings",
    )
    doctor_parser.add_argument("--db", type=Path, default=None)
    doctor_parser.add_argument("--rollouts", type=Path, default=None)
    add_ingest_args(doctor_parser)
    doctor_parser.add_argument("--sync", action="store_true")
    doctor_parser.add_argument("--json", dest="json_output", action="store_true")

    compare_parser = subparsers.add_parser(
        "compare",
        help="Compare usage, cost, sessions, and tool signals across two windows",
    )
    compare_parser.add_argument("--db", type=Path, default=None)
    compare_parser.add_argument("--rollouts", type=Path, default=None)
    add_ingest_args(compare_parser)
    add_range_args(compare_parser, help_prefix="current range")
    compare_parser.add_argument(
        "--vs",
        choices=["previous"],
        default="previous",
        help="Comparison strategy when --vs-from/--vs-to are omitted",
    )
    compare_parser.add_argument("--vs-from", dest="vs_from_date", type=str, default=None)
    compare_parser.add_argument("--vs-to", dest="vs_to_date", type=str, default=None)
    compare_parser.add_argument("--limit", type=int, default=10)
    compare_parser.add_argument("--json", dest="json_output", action="store_true")

    def add_ui_args(ui_subparser: argparse.ArgumentParser) -> None:
        ui_subparser.add_argument("--db", type=Path, default=None)
        ui_subparser.add_argument("--rollouts", type=Path, default=None)
        ui_subparser.add_argument("--port", type=int, default=None)
        ui_subparser.add_argument("--no-open", action="store_true")

    ui_parser = subparsers.add_parser("ui", help="Launch the Next.js dashboard")
    add_ui_args(ui_parser)

    web_parser = subparsers.add_parser(
        "web", help="Launch the web dashboard (alias for ui)"
    )
    add_ui_args(web_parser)

    ingest_cli_parser = subparsers.add_parser(
        "ingest-cli",
        help="Ingest Codex CLI output logs for status snapshots",
    )
    ingest_cli_parser.add_argument("--db", type=Path, default=None)
    ingest_cli_parser.add_argument(
        "--log",
        type=Path,
        default=Path("-"),
        help="Path to the CLI output log (use '-' for stdin)",
    )

    ingest_app_parser = subparsers.add_parser(
        "ingest-app-server",
        help="Ingest codex app-server JSON-RPC logs for timing metrics",
    )
    ingest_app_parser.add_argument("--db", type=Path, default=None)
    ingest_app_parser.add_argument(
        "--log",
        type=Path,
        default=Path("-"),
        help="Path to the app-server JSON-RPC log (use '-' for stdin)",
    )

    watch_parser = subparsers.add_parser(
        "watch",
        help="Watch rollouts and auto-ingest new files",
    )
    watch_parser.add_argument("--db", type=Path, default=None)
    watch_parser.add_argument("--rollouts", type=Path, default=None)
    watch_parser.add_argument(
        "--interval",
        type=float,
        default=30,
        help="Polling interval in seconds",
    )
    add_ingest_args(watch_parser)
    watch_parser.add_argument(
        "--last",
        type=str,
        default=None,
        help="Relative range like 7d, 12h, 1m (month), 30min, or total",
    )
    watch_parser.add_argument(
        "--today",
        action="store_true",
        help="Use today's usage for the initial ingest (midnight to now)",
    )
    watch_parser.add_argument("--from", dest="from_date", type=str, default=None)
    watch_parser.add_argument("--to", dest="to_date", type=str, default=None)
    watch_parser.add_argument(
        "--timezone",
        type=str,
        default=None,
        help=f"Timezone for initial range (IANA name, default {DEFAULT_TIMEZONE})",
    )

    clear_parser = subparsers.add_parser("clear-db", help="Delete the local usage DB")
    clear_parser.add_argument("--db", type=Path, default=None)
    clear_parser.add_argument("--yes", action="store_true")

    purge_parser = subparsers.add_parser(
        "purge-content",
        help="Delete stored content messages and tool calls from the usage DB",
    )
    purge_parser.add_argument("--db", type=Path, default=None)
    purge_parser.add_argument("--yes", action="store_true")

    purge_payloads_parser = subparsers.add_parser(
        "purge-payloads",
        help="Delete stored content messages and redact stored tool call payloads",
    )
    purge_payloads_parser.add_argument("--db", type=Path, default=None)
    purge_payloads_parser.add_argument("--yes", action="store_true")

    vacuum_parser = subparsers.add_parser(
        "vacuum",
        help="Run VACUUM to reclaim DB space after deletes (can take a while)",
    )
    vacuum_parser.add_argument("--db", type=Path, default=None)
    vacuum_parser.add_argument("--yes", action="store_true")

    return parser


def _ingest_for_range(
    args: argparse.Namespace,
    store: UsageStore,
    start: Optional[datetime],
    end: Optional[datetime],
    tz: ZoneInfo,
    ingest_mode: IngestMode,
) -> None:
    if ingest_mode == "none" and bool(getattr(args, "no_content", False)):
        store.purge_content()
    elif ingest_mode == "redact_payloads" and bool(getattr(args, "no_payloads", False)):
        store.purge_payloads()
    rollouts_dir = args.rollouts if args.rollouts else default_rollouts_dir()
    ingest_rollouts(
        rollouts_dir,
        store,
        start,
        end,
        tz,
        verbose=args.verbose,
        strict=args.strict,
        ingest_mode=ingest_mode,
        workers=getattr(args, "workers", None),
    )


def _parse_initial_watch_range(
    args: argparse.Namespace, tz: ZoneInfo
) -> Tuple[Optional[datetime], Optional[datetime]]:
    now = datetime.now(tz)
    start = None
    end = None
    if args.today:
        if args.last or args.from_date or args.to_date:
            raise ValueError("--today cannot be combined with --last/--from/--to")
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = now
    elif args.last:
        start, end = parse_last(args.last, now)
    else:
        if args.from_date:
            start = to_local(parse_datetime(args.from_date), tz)
        if args.to_date:
            end = to_local(parse_datetime(args.to_date), tz)
    return start, end


def _run_watch(
    args: argparse.Namespace,
    store: UsageStore,
    tz: ZoneInfo,
    start: Optional[datetime],
    end: Optional[datetime],
    ingest_mode: IngestMode,
) -> None:
    rollouts_dir = args.rollouts if args.rollouts else default_rollouts_dir()
    interval = max(1.0, float(args.interval))

    print(
        f"Watching {rollouts_dir} every {interval:.0f}s. Press Ctrl+C to stop."
    )
    last_scan_ts: Optional[float] = None

    try:
        while True:
            scan_start = time.time()
            ingest_rollouts(
                rollouts_dir,
                store,
                start,
                end,
                tz,
                verbose=args.verbose,
                strict=args.strict,
                ingest_mode=ingest_mode,
                workers=getattr(args, "workers", None),
            )

            last_scan_ts = scan_start
            start = datetime.fromtimestamp(last_scan_ts, tz)
            end = None

            time.sleep(interval)
    except KeyboardInterrupt:
        print("Stopping watch.")


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    db_path = args.db if getattr(args, "db", None) else default_db_path()
    command_lock = None
    pricing_reads_usage = args.command == "pricing" and getattr(args, "pricing_command", None) in (None, "list")
    if args.command in {"report", "export", "status", "insight", "sessions", "compare"} or pricing_reads_usage or (
        args.command == "doctor" and getattr(args, "sync", False)
    ):
        command_lock = _acquire_ingestion_lock(db_path)
    store = UsageStore(db_path)
    tz_override = getattr(args, "timezone", None)
    if tz_override:
        if not is_valid_timezone(tz_override):
            parser.error(
                f"Invalid --timezone '{tz_override}'. Expected an IANA timezone like "
                f"{DEFAULT_TIMEZONE}."
            )
    tz = resolve_timezone(db_path, tz_override)

    if args.command == "clear-db":
        path = args.db if args.db else default_db_path()
        if not args.yes:
            confirm = input(f"Delete {path}? Type 'delete' to confirm: ")
            if confirm.strip().lower() != "delete":
                print("Aborted.")
                return
        store.close()
        if path.exists():
            path.unlink()
            print(f"Deleted {path}")
        else:
            print(f"No database found at {path}")
        return

    if args.command == "profile":
        payload = _profile_db(store)
        store.close()
        if args.format == "json":
            print(json.dumps(payload, indent=2))
            return
        print(f"DB: {payload['path']}")
        print(
            "Versions: schema={schema_version} ingest={ingest_version} storage={storage_profile_version}".format(
                **payload
            )
        )
        print("Rows:")
        for name, count in payload["counts"].items():
            print(f"  {name}: {count:,}")
        ingestion = payload.get("ingestion") or {}
        if ingestion:
            print("Ingestion:")
            for key, value in ingestion.items():
                if isinstance(value, (int, float)):
                    print(f"  {key}: {value:,.0f}")
                else:
                    print(f"  {key}: {value}")
        if payload.get("sizes"):
            print("Largest DB objects:")
            for item in payload["sizes"][:12]:
                print(f"  {item['name']}: {item['bytes']:,} bytes")
        return

    if args.command == "doctor":
        if args.sync:
            try:
                ingest_mode = _resolve_ingest_mode(args, db_path)
            except ValueError as exc:
                parser.error(str(exc))
            _ingest_for_range(args, store, None, None, tz, ingest_mode)
        payload = doctor_payload(store)
        store.close()
        if args.json_output:
            print(json.dumps(payload, indent=2))
            return
        _print_doctor(payload)
        return

    if args.command == "pricing":
        pricing_command = getattr(args, "pricing_command", None) or "list"
        if pricing_command == "path":
            print(default_config_path(db_path))
            store.close()
            return
        if pricing_command == "set":
            if (
                args.input_rate is None
                and args.cached_input_rate is None
                and args.output_rate is None
                and args.per_unit is None
                and args.unit is None
                and args.currency_label is None
            ):
                parser.error(
                    "pricing set requires at least one of --input-rate, "
                    "--cached-input-rate, --output-rate, --per-unit, --unit, "
                    "or --currency-label"
                )
            payload = update_pricing_model(
                db_path,
                args.model,
                input_rate=args.input_rate,
                cached_input_rate=args.cached_input_rate,
                output_rate=args.output_rate,
                per_unit=args.per_unit,
                unit=args.unit,
                currency_label=args.currency_label,
            )
            store.close()
            if args.json_output:
                print(json.dumps(payload, indent=2))
                return
            print(f"Updated pricing for {payload['model']} in {payload['config_path']}")
            rates = payload["rates"]
            print(
                "Rates: input={input_rate} cached={cached_input_rate} output={output_rate}".format(
                    **rates
                )
            )
            return
        if pricing_command == "remove":
            payload = remove_pricing_override(db_path, args.model)
            store.close()
            if args.json_output:
                print(json.dumps(payload, indent=2))
                return
            action = "Removed override" if payload["removed"] else "No override found"
            print(f"{action} for {payload['model']} in {payload['config_path']}")
            return
        try:
            start, end = _parse_cli_range(args, tz, default_last="total")
            ingest_mode = _resolve_ingest_mode(args, db_path)
        except ValueError as exc:
            parser.error(str(exc))
        _ingest_for_range(args, store, start, end, tz, ingest_mode)
        payload = pricing_status(
            store,
            db_path,
            _to_utc_iso(start),
            _to_utc_iso(end),
            used_only=bool(args.used_only),
        )
        store.close()
        if args.json_output:
            print(json.dumps(payload, indent=2))
            return
        _print_pricing(payload)
        return

    if args.command == "purge-content":
        path = args.db if args.db else default_db_path()
        if not args.yes:
            confirm = input(
                f"Delete all content messages and tool calls from {path}? Type 'purge' to confirm: "
            )
            if confirm.strip().lower() != "purge":
                print("Aborted.")
                store.close()
                return
        messages, tool_calls = store.purge_content()
        store.close()
        print(
            f"Purged {messages} content messages and {tool_calls} tool calls from {path}."
        )
        return

    if args.command == "purge-payloads":
        path = args.db if args.db else default_db_path()
        if not args.yes:
            confirm = input(
                f"Delete all content messages and redact tool call payloads in {path}? "
                "Type 'purge' to confirm: "
            )
            if confirm.strip().lower() != "purge":
                print("Aborted.")
                store.close()
                return
        messages, tool_rows = store.purge_payloads()
        store.close()
        print(
            f"Purged {messages} content messages and redacted payloads in {tool_rows} tool calls from {path}."
        )
        return

    if args.command == "vacuum":
        path = args.db if args.db else default_db_path()
        if not args.yes:
            confirm = input(
                f"Run VACUUM on {path}? This can take a while. Type 'vacuum' to confirm: "
            )
            if confirm.strip().lower() != "vacuum":
                print("Aborted.")
                store.close()
                return
        store.vacuum()
        store.close()
        print(f"Vacuum completed for {path}.")
        return

    if args.command == "report":
        now = datetime.now(tz)
        start = None
        end = None
        if args.today:
            if args.last or args.from_date or args.to_date:
                parser.error("--today cannot be combined with --last/--from/--to")
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            end = now
        elif args.last:
            start, end = parse_last(args.last, now)
        else:
            if args.from_date:
                start = to_local(parse_datetime(args.from_date), tz)
            if args.to_date:
                end = to_local(parse_datetime(args.to_date), tz)

        try:
            ingest_mode = _resolve_ingest_mode(args, db_path)
        except ValueError as exc:
            parser.error(str(exc))
        _ingest_for_range(args, store, start, end, tz, ingest_mode)
        pricing, currency_label = load_pricing_config(db_path)
        weekly_quota = _estimate_weekly_quota(store, now, pricing, tz)
        if weekly_quota is None:
            latest_quota = store.latest_weekly_quota()
            weekly_quota = dict(latest_quota) if latest_quota else None
        events = _load_usage_events_for_range(store, start, end)
        rows = aggregate(events, args.group, args.by, pricing=pricing, tz=tz)
        include_group = args.by is not None
        if args.format == "table":
            output = render_table(rows, include_group, currency_label)
            if weekly_quota and weekly_quota.get("quota_tokens"):
                range_tokens = sum(int(event.get("total_tokens") or 0) for event in events)
                percent_used = (range_tokens / weekly_quota["quota_tokens"]) * 100.0
                print(f"Weekly quota used: {percent_used:.1f}%")
        elif args.format == "json":
            output = render_json(rows)
        else:
            output = render_csv(rows)
        print(output)
        store.close()
        return

    if args.command == "insight":
        try:
            start, end = _parse_cli_range(args, tz, default_last="7d")
            ingest_mode = _resolve_ingest_mode(args, db_path)
        except ValueError as exc:
            parser.error(str(exc))
        _ingest_for_range(args, store, start, end, tz, ingest_mode)
        pricing, currency_label = load_pricing_config(db_path)
        payload = insight_payload(
            store,
            _to_utc_iso(start),
            _to_utc_iso(end),
            pricing,
            limit=max(int(args.limit), 1),
        )
        store.close()
        if args.json_output:
            print(json.dumps(payload, indent=2))
            return
        _print_insight(payload, currency_label)
        return

    if args.command == "sessions":
        try:
            start, end = _parse_cli_range(args, tz, default_last="7d")
            ingest_mode = _resolve_ingest_mode(args, db_path)
        except ValueError as exc:
            parser.error(str(exc))
        _ingest_for_range(args, store, start, end, tz, ingest_mode)
        pricing, currency_label = load_pricing_config(db_path)
        rows = session_insights(
            store,
            _to_utc_iso(start),
            _to_utc_iso(end),
            pricing,
            limit=max(int(args.limit), 1),
            interesting=bool(args.interesting),
            cwd=args.cwd,
            model=args.model,
            search=args.search,
        )
        store.close()
        if args.json_output:
            print(json.dumps({"sessions": rows}, indent=2))
            return
        title = "Interesting sessions" if args.interesting else "Sessions"
        _print_session_rows(title, rows, currency_label)
        return

    if args.command == "compare":
        try:
            current_start, current_end, baseline_start, baseline_end = _parse_compare_ranges(args, tz)
            ingest_mode = _resolve_ingest_mode(args, db_path)
        except ValueError as exc:
            parser.error(str(exc))
        ingest_start = min(current_start, baseline_start)
        ingest_end = max(current_end, baseline_end)
        _ingest_for_range(args, store, ingest_start, ingest_end, tz, ingest_mode)
        pricing, currency_label = load_pricing_config(db_path)
        payload = compare_payload(
            store,
            _to_utc_iso(current_start),
            _to_utc_iso(current_end),
            _to_utc_iso(baseline_start),
            _to_utc_iso(baseline_end),
            pricing,
            limit=max(int(args.limit), 1),
        )
        store.close()
        if args.json_output:
            print(json.dumps(payload, indent=2))
            return
        _print_compare(payload, currency_label)
        return

    if args.command == "export":
        try:
            ingest_mode = _resolve_ingest_mode(args, db_path)
        except ValueError as exc:
            parser.error(str(exc))
        _ingest_for_range(args, store, None, None, tz, ingest_mode)
        rows = [dict(row) for row in store.iter_events()]
        if args.format == "json":
            output = export_events_json(rows)
        else:
            output = export_events_csv(rows)
        args.out.write_text(output)
        store.close()
        return

    if args.command == "status":
        try:
            ingest_mode = _resolve_ingest_mode(args, db_path)
        except ValueError as exc:
            parser.error(str(exc))
        _ingest_for_range(args, store, None, None, tz, ingest_mode)
        row = store.latest_status()
        if not row:
            print("No usage data captured yet.")
            store.close()
            return
        _print_status(dict(row))
        store.close()
        return

    if args.command == "ingest-cli":
        stats = ingest_cli_output(args.log, store, tz)
        store.close()
        print(
            f"Ingested {stats.lines} lines: {stats.status_snapshots} status snapshots, "
            f"{stats.usage_lines} usage lines."
        )
        return

    if args.command == "ingest-app-server":
        stats = ingest_app_server_output(args.log, store, tz)
        store.close()
        print(
            f"Ingested {stats.lines} lines: {stats.turns} turns, "
            f"{stats.items} items, {stats.web_actions} web actions."
        )
        return

    if args.command == "watch":
        try:
            start, end = _parse_initial_watch_range(args, tz)
        except ValueError as exc:
            parser.error(str(exc))
        try:
            ingest_mode = _resolve_ingest_mode(args, db_path)
        except ValueError as exc:
            parser.error(str(exc))
        _run_watch(args, store, tz, start, end, ingest_mode)
        store.close()
        return

    if args.command in ("ui", "web"):
        if args.db:
            os.environ["CODEX_USAGE_DB"] = str(args.db)
        if args.rollouts:
            os.environ["CODEX_USAGE_ROLLOUTS"] = str(args.rollouts)
        store.close()
        requested_port = args.port or 3000
        try:
            port = _resolve_web_port(requested_port)
        except ValueError as exc:
            parser.error(str(exc))
        if port != requested_port:
            print(
                f"Port {requested_port} is unavailable; starting dashboard on {port} instead.",
                file=sys.stderr,
            )
        if not args.no_open:
            _open_browser(f"http://localhost:{port}")
        repo_root = Path(__file__).resolve().parents[2]
        dist_root = _resolve_ui_dist(repo_root)
        if dist_root is not None:
            server_js = dist_root / "standalone" / "server.js"
            if server_js.exists():
                env = os.environ.copy()
                env["PORT"] = str(port)
                env.setdefault("NODE_ENV", "production")
                env.setdefault("CODEX_USAGE_BACKEND_ROOT", str(repo_root))
                env.setdefault("CODEX_USAGE_PYTHONPATH", str(repo_root / "src"))
                node_cmd = os.environ.get("CODEX_USAGE_NODE", "node")
                result = subprocess.run(
                    [node_cmd, str(server_js)],
                    env=env,
                    cwd=str(server_js.parent),
                    check=False,
                )
                sys.exit(result.returncode)
        ui_root = repo_root / "ui"
        if not ui_root.exists():
            raise RuntimeError(f"UI directory not found at {ui_root}")
        env = os.environ.copy()
        env["PORT"] = str(port)
        result = subprocess.run(
            ["pnpm", "--dir", str(ui_root), "dev", "--port", str(port)],
            env=env,
            check=False,
        )
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
