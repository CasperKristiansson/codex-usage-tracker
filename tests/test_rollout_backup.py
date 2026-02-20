import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from codex_usage_tracker.rollout_backup import (
    NoMatchingRolloutsError,
    create_rollout_backup,
    parse_iso_datetime,
)


def _write_rollout(path: Path, timestamps: list[str], *, invalid_first: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    if invalid_first:
        lines.append("{not-json")
    for timestamp in timestamps:
        lines.append(
            json.dumps(
                {
                    "timestamp": timestamp,
                    "type": "event_msg",
                    "payload": {"type": "token_count"},
                }
            )
        )
    path.write_text("\n".join(lines), encoding="utf-8")


def _read_manifest(archive_path: Path) -> dict:
    with tarfile.open(archive_path, "r:xz") as archive:
        member = archive.extractfile("backup-manifest.json")
        if member is None:
            raise AssertionError("backup-manifest.json not found in archive")
        return json.loads(member.read().decode("utf-8"))


def _archive_names(archive_path: Path) -> set[str]:
    with tarfile.open(archive_path, "r:xz") as archive:
        return set(archive.getnames())


class RolloutBackupTests(unittest.TestCase):
    def test_matches_inclusive_range_and_includes_session_folder(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir) / "rollouts"
            _write_rollout(
                root / "session-a" / "rollout-a.jsonl",
                ["2025-01-01T10:00:00.000Z", "2025-01-01T10:10:00.000Z"],
            )
            (root / "session-a" / "notes.txt").write_text("hello", encoding="utf-8")
            _write_rollout(
                root / "session-b" / "rollout-b.jsonl",
                ["2025-01-02T10:00:00.000Z"],
            )

            out_path = Path(tmpdir) / "backup.tar.xz"
            result = create_rollout_backup(
                root,
                parse_iso_datetime("2025-01-01T10:00:00Z"),
                parse_iso_datetime("2025-01-01T10:00:00Z"),
                out_path,
            )

            names = _archive_names(out_path)
            self.assertIn("session-a/rollout-a.jsonl", names)
            self.assertIn("session-a/notes.txt", names)
            self.assertNotIn("session-b/rollout-b.jsonl", names)
            self.assertIn("session-a", result.matched_session_dirs)

            manifest = _read_manifest(out_path)
            self.assertEqual(manifest["from"], "2025-01-01T10:00:00Z")
            self.assertEqual(manifest["to"], "2025-01-01T10:00:00Z")
            self.assertEqual(manifest["compression"], "tar.xz; preset=9")
            self.assertIn("session-a/rollout-a.jsonl", manifest["matched_rollout_files"])
            self.assertIn("session-a/notes.txt", manifest["included_files"])

    def test_invalid_lines_are_ignored(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir) / "rollouts"
            _write_rollout(
                root / "session-a" / "rollout-a.jsonl",
                ["2025-01-01T12:00:00.000Z"],
                invalid_first=True,
            )

            out_path = Path(tmpdir) / "backup.tar.xz"
            create_rollout_backup(
                root,
                parse_iso_datetime("2025-01-01T11:59:59Z"),
                parse_iso_datetime("2025-01-01T12:00:00Z"),
                out_path,
            )
            names = _archive_names(out_path)
            self.assertIn("session-a/rollout-a.jsonl", names)

    def test_top_level_rollout_file_is_included_without_whole_root(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir) / "rollouts"
            _write_rollout(
                root / "rollout-root.jsonl",
                ["2025-01-05T08:00:00.000Z"],
            )
            (root / "misc.txt").write_text("do-not-include", encoding="utf-8")

            out_path = Path(tmpdir) / "backup.tar.xz"
            create_rollout_backup(
                root,
                parse_iso_datetime("2025-01-05T08:00:00Z"),
                parse_iso_datetime("2025-01-05T08:00:00Z"),
                out_path,
            )

            names = _archive_names(out_path)
            self.assertIn("rollout-root.jsonl", names)
            self.assertNotIn("misc.txt", names)

    def test_raises_when_no_rollouts_match(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir) / "rollouts"
            _write_rollout(
                root / "session-a" / "rollout-a.jsonl",
                ["2025-01-01T10:00:00.000Z"],
            )
            out_path = Path(tmpdir) / "backup.tar.xz"

            with self.assertRaises(NoMatchingRolloutsError):
                create_rollout_backup(
                    root,
                    parse_iso_datetime("2026-01-01T00:00:00Z"),
                    parse_iso_datetime("2026-01-02T00:00:00Z"),
                    out_path,
                )


if __name__ == "__main__":
    unittest.main()
