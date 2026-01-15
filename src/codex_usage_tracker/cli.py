import argparse
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

from .platform import default_db_path, default_rollouts_dir
from .report import (
    STOCKHOLM_TZ,
    aggregate,
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
from .store import UsageEvent, UsageStore


@dataclass
class IngestStats:
    files_total: int = 0
    files_parsed: int = 0
    files_skipped: int = 0
    lines: int = 0
    events: int = 0
    errors: int = 0


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
    stats = IngestStats()
    files = list(_select_rollout_files(path, start, end))
    stats.files_total = len(files)
    progress = ProgressPrinter(stats.files_total)

    for idx, (file_path, mtime_ns, size, _) in enumerate(files, start=1):
        if not store.file_needs_ingest(str(file_path), mtime_ns, size):
            stats.files_skipped += 1
            progress.update(idx, stats, file_path)
            continue

        context = RolloutContext()
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

                    event = UsageEvent(
                        captured_at=parsed.captured_at_local.isoformat(),
                        captured_at_utc=parsed.captured_at_utc.isoformat(),
                        event_type="token_count",
                        total_tokens=parsed.tokens.get("total_tokens"),
                        input_tokens=parsed.tokens.get("input_tokens"),
                        cached_input_tokens=parsed.tokens.get("cached_input_tokens"),
                        output_tokens=parsed.tokens.get("output_tokens"),
                        reasoning_output_tokens=parsed.tokens.get(
                            "reasoning_output_tokens"
                        ),
                        context_used=parsed.context_used,
                        context_total=parsed.context_total,
                        context_percent_left=parsed.context_percent_left,
                        limit_5h_percent_left=parsed.limit_5h_percent_left,
                        limit_5h_resets_at=parsed.limit_5h_resets_at,
                        limit_weekly_percent_left=parsed.limit_weekly_percent_left,
                        limit_weekly_resets_at=parsed.limit_weekly_resets_at,
                        model=context.model,
                        directory=context.directory,
                        session_id=context.session_id,
                        codex_version=context.codex_version,
                        source=str(file_path),
                    )
                    store.insert_event(event)
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
                total=row.get("total_tokens") or 0,
                input=row.get("input_tokens") or 0,
                cached=row.get("cached_input_tokens") or 0,
                output=row.get("output_tokens") or 0,
            )
        )

    if row.get("context_total"):
        print(
            "Context window: {percent}% left ({used} used / {total})".format(
                percent=row.get("context_percent_left") or 0,
                used=row.get("context_used") or 0,
                total=row.get("context_total") or 0,
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

    if args.command == "report":
        now = datetime.now(STOCKHOLM_TZ)
        start = None
        end = None
        if args.last:
            delta = parse_last(args.last)
            start = now - delta
            end = now
        else:
            if args.from_date:
                start = to_local(parse_datetime(args.from_date))
            if args.to_date:
                end = to_local(parse_datetime(args.to_date))

        _ingest_for_range(args, store, start, end)
        events = _load_usage_events(store)
        events = _filter_range(events, start, end)
        rows = aggregate(events, args.group, args.by)
        include_group = args.by is not None
        if args.format == "table":
            output = render_table(rows, include_group)
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


if __name__ == "__main__":
    main()
