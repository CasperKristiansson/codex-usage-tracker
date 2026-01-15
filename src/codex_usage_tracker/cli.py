import argparse
import os
import pty
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, Optional
from zoneinfo import ZoneInfo

from .parser import StatusCapture, map_limits, parse_token_usage_line
from .platform import default_db_path
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
from .store import UsageEvent, UsageStore


@dataclass
class CaptureContext:
    model: Optional[str] = None
    directory: Optional[str] = None
    session_id: Optional[str] = None
    codex_version: Optional[str] = None


class OutputParser:
    def __init__(self, store: UsageStore, context: CaptureContext) -> None:
        self.store = store
        self.context = context
        self.status_capture = StatusCapture()
        self._buffer = ""

    def feed(self, data: bytes) -> None:
        text = data.decode(errors="replace")
        text = text.replace("\r", "\n")
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._handle_line(line)

    def _handle_line(self, line: str) -> None:
        token_usage = parse_token_usage_line(line)
        if token_usage:
            self._record_usage(token_usage)

        snapshot = self.status_capture.feed_line(line)
        if snapshot:
            self.context.model = snapshot.model or self.context.model
            self.context.directory = snapshot.directory or self.context.directory
            self.context.session_id = snapshot.session_id or self.context.session_id
            self.context.codex_version = snapshot.codex_version or self.context.codex_version

            limit_5h_percent, limit_5h_resets, limit_weekly_percent, limit_weekly_resets = (
                map_limits(snapshot)
            )

            now_local = datetime.now(STOCKHOLM_TZ)
            now_utc = now_local.astimezone(ZoneInfo("UTC"))
            event = UsageEvent(
                captured_at=now_local.isoformat(),
                captured_at_utc=now_utc.isoformat(),
                event_type="status_snapshot",
                total_tokens=snapshot.token_usage.get("total_tokens")
                if snapshot.token_usage
                else None,
                input_tokens=snapshot.token_usage.get("input_tokens")
                if snapshot.token_usage
                else None,
                output_tokens=snapshot.token_usage.get("output_tokens")
                if snapshot.token_usage
                else None,
                context_used=snapshot.context_window.get("used_tokens")
                if snapshot.context_window
                else None,
                context_total=snapshot.context_window.get("total_tokens")
                if snapshot.context_window
                else None,
                context_percent_left=snapshot.context_window.get("percent_left")
                if snapshot.context_window
                else None,
                limit_5h_percent_left=limit_5h_percent,
                limit_5h_resets_at=limit_5h_resets,
                limit_weekly_percent_left=limit_weekly_percent,
                limit_weekly_resets_at=limit_weekly_resets,
                model=self.context.model,
                directory=self.context.directory,
                session_id=self.context.session_id,
                codex_version=self.context.codex_version,
                source="stdout",
            )
            self.store.insert_event(event)

    def _record_usage(self, token_usage: Dict[str, int]) -> None:
        now_local = datetime.now(STOCKHOLM_TZ)
        now_utc = now_local.astimezone(ZoneInfo("UTC"))
        event = UsageEvent(
            captured_at=now_local.isoformat(),
            captured_at_utc=now_utc.isoformat(),
            event_type="usage_line",
            total_tokens=token_usage.get("total_tokens"),
            input_tokens=token_usage.get("input_tokens"),
            cached_input_tokens=token_usage.get("cached_input_tokens"),
            output_tokens=token_usage.get("output_tokens"),
            reasoning_output_tokens=token_usage.get("reasoning_output_tokens"),
            model=self.context.model,
            directory=self.context.directory,
            session_id=self.context.session_id,
            codex_version=self.context.codex_version,
            source="stdout",
        )
        self.store.insert_event(event)


def run_wrapper(cmd: Iterable[str], store: UsageStore, cwd: Optional[str]) -> int:
    if not cmd:
        raise ValueError("No command provided")

    context = CaptureContext(directory=cwd)
    parser = OutputParser(store, context)

    def master_read(fd: int) -> bytes:
        data = os.read(fd, 1024)
        if data:
            parser.feed(data)
        return data

    original_cwd = os.getcwd()
    if cwd:
        os.chdir(cwd)
    try:
        status = pty.spawn(list(cmd), master_read=master_read)
    finally:
        if cwd:
            os.chdir(original_cwd)
        parser.feed(b"\n")

    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


def _load_usage_events(store: UsageStore) -> Iterable[Dict[str, object]]:
    rows = store.iter_events(event_type="usage_line")
    return [dict(row) for row in rows]


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

    run_parser = subparsers.add_parser("run", help="Run codex and capture usage")
    run_parser.add_argument("--db", type=Path, default=None)
    run_parser.add_argument("--cwd", type=str, default=None)
    run_parser.add_argument("cmd", nargs=argparse.REMAINDER)

    report_parser = subparsers.add_parser("report", help="Aggregate usage reports")
    report_parser.add_argument("--db", type=Path, default=None)
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
    export_parser.add_argument(
        "--format", choices=["json", "csv"], default="json"
    )
    export_parser.add_argument("--out", type=Path, required=True)

    status_parser = subparsers.add_parser(
        "status", help="Show latest captured quota/context snapshot"
    )
    status_parser.add_argument("--db", type=Path, default=None)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    db_path = args.db if args.db else default_db_path()
    store = UsageStore(db_path)

    if args.command == "run":
        cmd = list(args.cmd)
        if cmd and cmd[0] == "--":
            cmd = cmd[1:]
        if not cmd:
            parser.error("run requires a command after --")
        cwd = args.cwd or os.getcwd()
        exit_code = run_wrapper(cmd, store, cwd)
        store.close()
        sys.exit(exit_code)

    if args.command == "report":
        events = _load_usage_events(store)
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
        rows = [dict(row) for row in store.iter_events()]
        if args.format == "json":
            output = export_events_json(rows)
        else:
            output = export_events_csv(rows)
        args.out.write_text(output)
        store.close()
        return

    if args.command == "status":
        row = store.latest_status()
        if not row:
            print("No status snapshots captured yet.")
            store.close()
            return
        _print_status(dict(row))
        store.close()
        return


if __name__ == "__main__":
    main()
