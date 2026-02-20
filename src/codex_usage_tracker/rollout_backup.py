from __future__ import annotations

import argparse
import io
import json
import sys
import tarfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List

from .rollout import iter_rollout_files, parse_rollout_timestamp

NO_MATCH_EXIT_CODE = 3


class RolloutBackupError(RuntimeError):
    pass


class NoMatchingRolloutsError(RolloutBackupError):
    pass


@dataclass
class BackupResult:
    archive_path: Path
    generated_at: str
    from_iso: str
    to_iso: str
    rollouts_root: str
    matched_rollout_files: List[str]
    matched_session_dirs: List[str]
    included_files: List[str]
    compression: str
    period_mode: str
    file_scope: str


def _iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso_datetime(value: str) -> datetime:
    raw = value.strip()
    if not raw:
        raise ValueError("Timestamp cannot be empty.")
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _safe_relative(root: Path, path: Path) -> Path:
    root_resolved = root.resolve()
    path_resolved = path.resolve()
    try:
        return path_resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise RolloutBackupError(
            f"Refusing to include path outside rollouts root: {path_resolved}"
        ) from exc


def _rollout_file_matches(path: Path, start: datetime, end: datetime) -> bool:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict):
                    continue
                timestamp = payload.get("timestamp")
                if not isinstance(timestamp, str):
                    continue
                try:
                    captured = parse_rollout_timestamp(timestamp).astimezone(
                        timezone.utc
                    )
                except ValueError:
                    continue
                if start <= captured <= end:
                    return True
    except OSError as exc:
        raise RolloutBackupError(f"Failed to read rollout file {path}: {exc}") from exc
    return False


def _iter_session_files(session_dir: Path) -> Iterable[Path]:
    for path in session_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.is_symlink():
            continue
        yield path


def create_rollout_backup(
    rollouts_root: Path,
    start: datetime,
    end: datetime,
    out_path: Path,
) -> BackupResult:
    if start > end:
        raise RolloutBackupError("'from' must be before or equal to 'to'.")

    root = rollouts_root.resolve()
    if not root.exists():
        raise RolloutBackupError(f"Rollouts directory does not exist: {root}")
    if not root.is_dir():
        raise RolloutBackupError(f"Rollouts path is not a directory: {root}")

    matched_rollouts: List[Path] = []
    matched_session_dirs: set[Path] = set()
    matched_top_level_rollouts: set[Path] = set()

    for rollout_file in sorted(iter_rollout_files(root)):
        if not _rollout_file_matches(rollout_file, start, end):
            continue
        matched_rollouts.append(rollout_file)
        if rollout_file.parent.resolve() == root:
            matched_top_level_rollouts.add(rollout_file)
        else:
            matched_session_dirs.add(rollout_file.parent)

    if not matched_rollouts:
        raise NoMatchingRolloutsError("No rollout sessions found in the selected period.")

    included_files: set[Path] = set()
    for session_dir in matched_session_dirs:
        for file_path in _iter_session_files(session_dir):
            _safe_relative(root, file_path)
            included_files.add(file_path)

    for top_level_rollout in matched_top_level_rollouts:
        _safe_relative(root, top_level_rollout)
        included_files.add(top_level_rollout)

    if not included_files:
        raise NoMatchingRolloutsError("No files were included for the selected period.")

    sorted_included_paths = sorted(
        included_files, key=lambda item: _safe_relative(root, item).as_posix()
    )
    included_relative = [_safe_relative(root, item).as_posix() for item in sorted_included_paths]
    matched_rollout_relative = [
        _safe_relative(root, item).as_posix() for item in sorted(matched_rollouts)
    ]
    matched_session_relative = [
        _safe_relative(root, item).as_posix() for item in sorted(matched_session_dirs)
    ]

    generated_at = _iso_utc(datetime.now(timezone.utc))
    manifest = {
        "generated_at": generated_at,
        "from": _iso_utc(start),
        "to": _iso_utc(end),
        "rollouts_root": str(root),
        "matched_rollout_files": matched_rollout_relative,
        "matched_session_dirs": matched_session_relative,
        "included_files": included_relative,
        "compression": "tar.xz; preset=9",
        "period_mode": "parsed_rollout_timestamps_inclusive",
        "file_scope": "whole_session_folder_or_top_level_rollout",
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out_path, mode="w:xz", preset=9) as archive:
        for file_path in sorted_included_paths:
            relative = _safe_relative(root, file_path).as_posix()
            archive.add(file_path, arcname=relative, recursive=False)

        manifest_bytes = json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8")
        manifest_info = tarfile.TarInfo(name="backup-manifest.json")
        manifest_info.size = len(manifest_bytes)
        manifest_info.mtime = int(datetime.now(timezone.utc).timestamp())
        archive.addfile(manifest_info, io.BytesIO(manifest_bytes))

    return BackupResult(
        archive_path=out_path,
        generated_at=generated_at,
        from_iso=_iso_utc(start),
        to_iso=_iso_utc(end),
        rollouts_root=str(root),
        matched_rollout_files=matched_rollout_relative,
        matched_session_dirs=matched_session_relative,
        included_files=included_relative,
        compression=manifest["compression"],
        period_mode=manifest["period_mode"],
        file_scope=manifest["file_scope"],
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m codex_usage_tracker.rollout_backup",
        description="Create a compressed rollout backup archive for a selected period.",
    )
    parser.add_argument("--rollouts", type=Path, required=True)
    parser.add_argument("--from", dest="from_date", type=str, required=True)
    parser.add_argument("--to", dest="to_date", type=str, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    try:
        start = parse_iso_datetime(args.from_date)
        end = parse_iso_datetime(args.to_date)
    except ValueError as exc:
        print(f"Invalid date input: {exc}", file=sys.stderr)
        return 2

    try:
        result = create_rollout_backup(args.rollouts, start, end, args.out)
    except NoMatchingRolloutsError as exc:
        print(str(exc), file=sys.stderr)
        return NO_MATCH_EXIT_CODE
    except RolloutBackupError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    summary = {
        "archive_path": str(result.archive_path),
        "generated_at": result.generated_at,
        "from": result.from_iso,
        "to": result.to_iso,
        "matched_rollout_files": len(result.matched_rollout_files),
        "matched_session_dirs": len(result.matched_session_dirs),
        "included_files": len(result.included_files),
    }
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
