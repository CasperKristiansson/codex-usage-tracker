import argparse
import os
import sys
import threading
import time
import webbrowser
from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple
from zoneinfo import ZoneInfo

from .platform import default_db_path, default_rollouts_dir
from .report import (
    STOCKHOLM_TZ,
    aggregate,
    compute_costs,
    default_pricing,
    export_events_csv,
    export_events_json,
    parse_datetime,
    parse_last,
    render_csv,
    render_json,
    render_table,
    to_local,
)
from .rollout import RolloutContext, iter_rollout_files, parse_rollout_line
from .parser import StatusCapture, map_limits, parse_token_usage_line
from .store import ActivityEvent, SessionMeta, TurnContext, UsageEvent, UsageStore
from importlib import resources


@dataclass
class IngestStats:
    files_total: int = 0
    files_parsed: int = 0
    files_skipped: int = 0
    lines: int = 0
    events: int = 0
    errors: int = 0


@dataclass
class CliLogStats:
    lines: int = 0
    status_snapshots: int = 0
    usage_lines: int = 0


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


def _select_rollout_files(
    root: Path,
    start: Optional[datetime],
    end: Optional[datetime],
) -> Iterable[Tuple[Path, int, int, datetime]]:
    for path in iter_rollout_files(root):
        try:
            stat = path.stat()
        except OSError:
            continue
        mtime = datetime.fromtimestamp(stat.st_mtime, tz=STOCKHOLM_TZ)
        if start and mtime < start:
            continue
        if end and mtime > end:
            continue
        yield path, stat.st_mtime_ns, stat.st_size, mtime


def ingest_rollouts(
    path: Path,
    store: UsageStore,
    start: Optional[datetime],
    end: Optional[datetime],
) -> IngestStats:
    store.ensure_ingest_version()
    stats = IngestStats()
    files = list(_select_rollout_files(path, start, end))
    stats.files_total = len(files)
    progress = ProgressPrinter(stats.files_total)
    turn_counters: Dict[str, int] = {}

    for idx, (file_path, mtime_ns, size, _) in enumerate(files, start=1):
        if not store.file_needs_ingest(str(file_path), mtime_ns, size):
            stats.files_skipped += 1
            progress.update(idx, stats, file_path)
            continue

        store.delete_events_for_source(str(file_path))
        store.delete_turns_for_source(str(file_path))
        store.delete_activity_events_for_source(str(file_path))
        context = RolloutContext()
        session_meta_saved = False
        try:
            with file_path.open("r", encoding="utf-8") as handle:
                for raw in handle:
                    raw = raw.strip()
                    if not raw:
                        continue
                    stats.lines += 1
                    try:
                        parsed, context = parse_rollout_line(raw, context)
                    except Exception:
                        stats.errors += 1
                        continue
                    if parsed is None:
                        continue
                    if parsed.session_meta is not None and not session_meta_saved:
                        session_meta_saved = True
                        session = parsed.session_meta
                        if session.session_id:
                            store.upsert_session(
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
                        store.insert_turn(
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
                        event = UsageEvent(
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
                        store.insert_event(event)
                        stats.events += 1

                    if parsed.event_marker is not None:
                        marker = parsed.event_marker
                        event = UsageEvent(
                            captured_at=marker.captured_at_local.isoformat(),
                            captured_at_utc=marker.captured_at_utc.isoformat(),
                            event_type=marker.event_type,
                            model=context.model,
                            directory=context.directory,
                            session_id=context.session_id,
                            codex_version=context.codex_version,
                            source=str(file_path),
                        )
                        store.insert_event(event)
                        stats.events += 1

                    if parsed.activity_events:
                        turn_key = context.session_id or f"file:{file_path}"
                        turn_index = turn_counters.get(turn_key)
                        for activity in parsed.activity_events:
                            if activity.count <= 0:
                                continue
                            store.insert_activity_event(
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
                            stats.events += 1
        except OSError:
            stats.errors += 1
            progress.update(idx, stats, file_path)
            continue

        store.mark_file_ingested(str(file_path), mtime_ns, size)
        stats.files_parsed += 1
        progress.update(idx, stats, file_path)

    progress.finish()
    return stats


def ingest_cli_output(
    log_path: Path,
    store: UsageStore,
) -> CliLogStats:
    stats = CliLogStats()
    capture = StatusCapture()
    stat_info = None
    if log_path.name != "-":
        try:
            stat_info = log_path.stat()
        except OSError:
            return stats
        if not store.file_needs_ingest(str(log_path), stat_info.st_mtime_ns, stat_info.st_size):
            return stats
        store.delete_events_for_source(str(log_path))

    def _handle_snapshot(snapshot) -> None:
        nonlocal stats
        captured_at = datetime.now(STOCKHOLM_TZ)
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
        store.insert_event(event)
        stats.status_snapshots += 1

    def _handle_usage(tokens: Dict[str, int]) -> None:
        nonlocal stats
        captured_at = datetime.now(STOCKHOLM_TZ)
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
        store.insert_event(event)
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
    if stat_info is not None:
        store.mark_file_ingested(str(log_path), stat_info.st_mtime_ns, stat_info.st_size)
    return stats


def _load_usage_events(store: UsageStore) -> Iterable[Dict[str, object]]:
    rows = store.iter_events()
    events = [dict(row) for row in rows]
    return [
        event
        for event in events
        if event.get("event_type") in ("usage_line", "token_count")
    ]


def _filter_range(
    events: Iterable[Dict[str, object]],
    start: Optional[datetime],
    end: Optional[datetime],
) -> Iterable[Dict[str, object]]:
    filtered = []
    for event in events:
        captured_at = parse_datetime(event["captured_at"])
        local_dt = to_local(captured_at)
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
) -> Optional[Dict[str, object]]:
    week_start, week_end = _last_completed_week(now)
    rows = store.iter_events(start=week_start.isoformat(), end=week_end.isoformat())
    events = [dict(row) for row in rows]
    if not events:
        return None
    events = [
        event
        for event in events
        if event.get("event_type") in ("usage_line", "token_count")
    ]
    events = _filter_range(events, week_start, week_end)
    if not events:
        return None

    total_tokens = sum(int(event.get("total_tokens") or 0) for event in events)
    total_cost, _, _, _ = compute_costs(events, default_pricing())
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codex-track")
    subparsers = parser.add_subparsers(dest="command", required=True)

    report_parser = subparsers.add_parser("report", help="Aggregate usage reports")
    report_parser.add_argument("--db", type=Path, default=None)
    report_parser.add_argument("--rollouts", type=Path, default=None)
    report_parser.add_argument("--last", type=str, default=None)
    report_parser.add_argument(
        "--today",
        action="store_true",
        help="Use today's usage (midnight to now, local timezone)",
    )
    report_parser.add_argument("--from", dest="from_date", type=str, default=None)
    report_parser.add_argument("--to", dest="to_date", type=str, default=None)
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
    export_parser.add_argument("--format", choices=["json", "csv"], default="json")
    export_parser.add_argument("--out", type=Path, required=True)

    status_parser = subparsers.add_parser(
        "status", help="Show latest captured usage snapshot"
    )
    status_parser.add_argument("--db", type=Path, default=None)
    status_parser.add_argument("--rollouts", type=Path, default=None)

    web_parser = subparsers.add_parser("web", help="Launch the Streamlit dashboard")
    web_parser.add_argument("--db", type=Path, default=None)
    web_parser.add_argument("--rollouts", type=Path, default=None)
    web_parser.add_argument("--last", type=str, default=None)
    web_parser.add_argument(
        "--today",
        action="store_true",
        help="Use today's usage (midnight to now, local timezone)",
    )
    web_parser.add_argument("--from", dest="from_date", type=str, default=None)
    web_parser.add_argument("--to", dest="to_date", type=str, default=None)
    web_parser.add_argument("--port", type=int, default=None)

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

    clear_parser = subparsers.add_parser("clear-db", help="Delete the local usage DB")
    clear_parser.add_argument("--db", type=Path, default=None)
    clear_parser.add_argument("--yes", action="store_true")

    return parser


def _ingest_for_range(
    args: argparse.Namespace,
    store: UsageStore,
    start: Optional[datetime],
    end: Optional[datetime],
) -> None:
    rollouts_dir = args.rollouts if args.rollouts else default_rollouts_dir()
    ingest_rollouts(rollouts_dir, store, start, end)


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    db_path = args.db if args.db else default_db_path()
    store = UsageStore(db_path)

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

    if args.command == "report":
        now = datetime.now(STOCKHOLM_TZ)
        start = None
        end = None
        if args.today:
            if args.last or args.from_date or args.to_date:
                parser.error("--today cannot be combined with --last/--from/--to")
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            end = now
        elif args.last:
            delta = parse_last(args.last)
            start = now - delta
            end = now
        else:
            if args.from_date:
                start = to_local(parse_datetime(args.from_date))
            if args.to_date:
                end = to_local(parse_datetime(args.to_date))

        _ingest_for_range(args, store, start, end)
        weekly_quota = _estimate_weekly_quota(store, now)
        if weekly_quota is None:
            latest_quota = store.latest_weekly_quota()
            weekly_quota = dict(latest_quota) if latest_quota else None
        events = _load_usage_events(store)
        events = _filter_range(events, start, end)
        rows = aggregate(events, args.group, args.by, pricing=default_pricing())
        include_group = args.by is not None
        if args.format == "table":
            output = render_table(rows, include_group)
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

    if args.command == "export":
        _ingest_for_range(args, store, None, None)
        rows = [dict(row) for row in store.iter_events()]
        if args.format == "json":
            output = export_events_json(rows)
        else:
            output = export_events_csv(rows)
        args.out.write_text(output)
        store.close()
        return

    if args.command == "status":
        _ingest_for_range(args, store, None, None)
        row = store.latest_status()
        if not row:
            print("No usage data captured yet.")
            store.close()
            return
        _print_status(dict(row))
        store.close()
        return

    if args.command == "ingest-cli":
        stats = ingest_cli_output(args.log, store)
        store.close()
        print(
            f"Ingested {stats.lines} lines: {stats.status_snapshots} status snapshots, "
            f"{stats.usage_lines} usage lines."
        )
        return

    if args.command == "web":
        if args.db:
            os.environ["CODEX_USAGE_DB"] = str(args.db)
        if args.rollouts:
            os.environ["CODEX_USAGE_ROLLOUTS"] = str(args.rollouts)
        if args.today:
            if args.last or args.from_date or args.to_date:
                parser.error("--today cannot be combined with --last/--from/--to")
            now = datetime.now(STOCKHOLM_TZ)
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            os.environ["CODEX_USAGE_FROM"] = start.isoformat()
            os.environ["CODEX_USAGE_TO"] = now.isoformat()
        else:
            if args.last:
                os.environ["CODEX_USAGE_LAST"] = str(args.last)
            if args.from_date:
                os.environ["CODEX_USAGE_FROM"] = str(args.from_date)
            if args.to_date:
                os.environ["CODEX_USAGE_TO"] = str(args.to_date)
        store.close()
        try:
            from streamlit.web import cli as stcli
        except Exception as exc:
            raise RuntimeError(
                "Streamlit is required for the web dashboard. Install with: pip install streamlit"
            ) from exc

        app_path = resources.files("codex_usage_tracker") / "web_app.py"
        argv = ["streamlit", "run", str(app_path), "--server.headless", "true"]
        if args.port:
            argv += ["--server.port", str(args.port)]
        port = args.port or 8501
        _open_browser(f"http://localhost:{port}")
        sys.argv = argv
        sys.exit(stcli.main())


if __name__ == "__main__":
    main()
