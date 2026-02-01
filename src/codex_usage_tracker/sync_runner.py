from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

from .cli import IngestStats, ingest_rollouts
from .platform import default_db_path, default_rollouts_dir
from .report import parse_datetime, to_local
from .store import UsageStore


def _write_progress(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=True))
    tmp_path.replace(path)


def _progress_payload(
    sync_id: str,
    status: str,
    stats: Optional[IngestStats],
) -> dict:
    return {
        "sync_id": sync_id,
        "status": status,
        "progress": asdict(stats) if stats else None,
    }


def run_sync(
    db_path: Path,
    rollouts_path: Path,
    start: Optional[datetime],
    end: Optional[datetime],
    progress_path: Path,
    sync_id: str,
) -> int:
    store = UsageStore(db_path)
    latest_stats: Optional[IngestStats] = None

    def _callback(stats: IngestStats, _current: int, _total: int, _path: Optional[Path]) -> None:
        nonlocal latest_stats
        latest_stats = stats
        _write_progress(progress_path, _progress_payload(sync_id, "running", stats))

    try:
        _write_progress(progress_path, _progress_payload(sync_id, "running", None))
        latest_stats = ingest_rollouts(rollouts_path, store, start, end, _callback)
        _write_progress(
            progress_path, _progress_payload(sync_id, "completed", latest_stats)
        )
        return 0
    except Exception as exc:  # pylint: disable=broad-except
        payload = _progress_payload(sync_id, "failed", latest_stats)
        payload["error"] = str(exc)
        _write_progress(progress_path, payload)
        return 1
    finally:
        store.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=None)
    parser.add_argument("--rollouts", type=Path, default=None)
    parser.add_argument("--from", dest="from_date", type=str, default=None)
    parser.add_argument("--to", dest="to_date", type=str, default=None)
    parser.add_argument("--progress-file", type=Path, required=True)
    parser.add_argument("--sync-id", type=str, required=True)
    args = parser.parse_args()

    db_path = args.db if args.db else default_db_path()
    rollouts_path = args.rollouts if args.rollouts else default_rollouts_dir()
    start = to_local(parse_datetime(args.from_date)) if args.from_date else None
    end = to_local(parse_datetime(args.to_date)) if args.to_date else None

    return run_sync(db_path, rollouts_path, start, end, args.progress_file, args.sync_id)


if __name__ == "__main__":
    sys.exit(main())
