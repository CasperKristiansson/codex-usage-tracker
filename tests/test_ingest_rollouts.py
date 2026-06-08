import json
import os
import tempfile
import unittest
from pathlib import Path
import sys
import sqlite3
import subprocess
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = str(ROOT / "src")
sys.path.insert(0, SRC_PATH)

from codex_usage_tracker.cli import DEFAULT_INGEST_WORKERS
from codex_usage_tracker.store import ActivityEvent, MessageEvent, ToolCallEvent, UsageStore


def _run_export(
    rollouts_dir: Path,
    db_path: Path,
    extra_args: Optional[list[str]] = None,
) -> None:
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{SRC_PATH}{os.pathsep}{env.get('PYTHONPATH', '')}"
    out_path = db_path.parent / "export.json"
    command = [
        sys.executable,
        "-m",
        "codex_usage_tracker.cli",
        "export",
        "--db",
        str(db_path),
        "--rollouts",
        str(rollouts_dir),
        "--format",
        "json",
        "--out",
        str(out_path),
    ]
    if extra_args:
        command.extend(extra_args)
    subprocess.run(command, check=True, env=env, capture_output=True, text=True)


def _write_rollout_file(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    rollout_path = root / "rollout-2025-01-01.jsonl"
    lines = [
        {
            "timestamp": "2025-01-01T10:00:00.000Z",
            "type": "session_meta",
            "payload": {
                "id": "session-1",
                "timestamp": "2025-01-01T09:59:59.000Z",
                "cwd": "/tmp/project",
                "originator": "cli",
                "cli_version": "0.10.0",
                "source": "cli",
                "model_provider": "openai",
                "git": {
                    "commit_hash": "abc123",
                    "branch": "main",
                    "repository_url": "https://example.com/repo.git",
                },
            },
        },
        {
            "timestamp": "2025-01-01T10:00:01.000Z",
            "type": "turn_context",
            "payload": {
                "cwd": "/tmp/project",
                "model": "gpt-5.1",
                "approval_policy": "on-request",
                "sandbox_policy": {
                    "type": "workspace-write",
                    "writable_roots": ["/tmp/extra"],
                    "network_access": True,
                    "exclude_tmpdir_env_var": True,
                    "exclude_slash_tmp": False,
                },
                "effort": "high",
                "summary": "concise",
                "base_instructions": "hello",
                "developer_instructions": "",
                "truncation_policy": {"mode": "tokens", "limit": 2048},
            },
        },
        {
            "timestamp": "2025-01-01T10:00:02.000Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 50,
                        "cached_input_tokens": 0,
                        "output_tokens": 10,
                        "reasoning_output_tokens": 0,
                        "total_tokens": 17000,
                    },
                    "last_token_usage": {
                        "input_tokens": 20,
                        "cached_input_tokens": 0,
                        "output_tokens": 5,
                        "reasoning_output_tokens": 0,
                        "total_tokens": 25,
                    },
                    "model_context_window": 22000,
                },
                "rate_limits": {
                    "primary": {
                        "used_percent": 20.0,
                        "window_minutes": 300,
                        "resets_at": 1735725600,
                    },
                    "secondary": {
                        "used_percent": 10.0,
                        "window_minutes": 10080,
                        "resets_at": 1735812000,
                    },
                    "credits": {
                        "has_credits": True,
                        "unlimited": False,
                        "balance": "3.50",
                    },
                    "plan_type": "pro",
                },
            },
        },
        {
            "timestamp": "2025-01-01T10:00:03.000Z",
            "type": "event_msg",
            "payload": {"type": "context_compacted"},
        },
        {
            "timestamp": "2025-01-01T10:00:04.000Z",
            "type": "event_msg",
            "payload": {
                "type": "user_message",
                "message": "hi",
                "images": ["https://example.com/1.png"],
                "local_images": ["/tmp/a.png"],
            },
        },
        {
            "timestamp": "2025-01-01T10:00:05.000Z",
            "type": "response_item",
            "payload": {
                "type": "local_shell_call",
                "status": "completed",
                "call_id": "call-1",
                "action": {"type": "exec", "command": ["git", "status"]},
            },
        },
        {
            "timestamp": "2025-01-01T10:00:06.000Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "status": "completed",
                "call_id": "call-2",
                "name": "exec_command",
                "arguments": {"cmd": "date"},
            },
        },
        {
            "timestamp": "2025-01-01T10:00:07.000Z",
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "call-2",
                "output": {"stdout": "ok"},
            },
        },
    ]
    rollout_path.write_text("\n".join(json.dumps(line) for line in lines))
    os.utime(rollout_path, None)
    return rollout_path


class RolloutIngestTests(unittest.TestCase):
    def test_ingest_rollout_writes_expected_tables(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            rollouts_dir = root / "rollouts"
            _write_rollout_file(rollouts_dir)
            db_path = root / "usage.sqlite"
            _run_export(rollouts_dir, db_path, extra_args=["--with-payloads"])

            conn = sqlite3.connect(db_path)
            try:
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 1
                )
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM turns").fetchone()[0], 1
                )

                token_row = conn.execute(
                "SELECT event_type, limit_5h_percent_left, limit_weekly_percent_left, "
                "rate_limit_plan_type, rate_limit_balance "
                "FROM events WHERE event_type = 'token_count'"
                ).fetchone()
                self.assertIsNotNone(token_row)
                self.assertEqual(token_row[0], "token_count")
                self.assertEqual(token_row[1], 80.0)
                self.assertEqual(token_row[2], 90.0)
                self.assertEqual(token_row[3], "pro")
                self.assertEqual(token_row[4], "3.50")

                marker_count = conn.execute(
                "SELECT COUNT(*) FROM events WHERE event_type = 'context_compacted'"
                ).fetchone()[0]
                self.assertEqual(marker_count, 1)

                activity_types = {
                    row[0]
                    for row in conn.execute(
                        "SELECT DISTINCT event_type FROM activity_events"
                    ).fetchall()
                }
                self.assertEqual(activity_types, {"user_image", "user_local_image"})

                tool_rows = conn.execute(
                    "SELECT tool_type, tool_name, command, input_text, output_text, input_length, output_length, payload_truncated FROM tool_calls ORDER BY captured_at_utc"
                ).fetchall()
                self.assertEqual(len(tool_rows), 3)
                self.assertEqual(tool_rows[0][0], "local_shell")
                self.assertIn("git", tool_rows[0][2] or "")
                self.assertEqual(tool_rows[0][7], 0)
                self.assertEqual(tool_rows[1][0], "function_call")
                self.assertEqual(tool_rows[1][1], "exec_command")
                self.assertIsNotNone(tool_rows[1][3])
                self.assertEqual(tool_rows[1][5], len(tool_rows[1][3]))
                self.assertEqual(tool_rows[2][0], "function_call_output")
                self.assertIsNotNone(tool_rows[2][4])
                self.assertEqual(tool_rows[2][6], len(tool_rows[2][4]))
                self.assertEqual(tool_rows[2][7], 0)

                message_row = conn.execute(
                "SELECT role, message_type, message FROM content_messages"
                ).fetchone()
                self.assertIsNotNone(message_row)
                self.assertEqual(message_row[0], "user")
                self.assertEqual(message_row[1], "event_msg")
                self.assertEqual(message_row[2], "hi")
            finally:
                conn.close()

    def test_with_payloads_caps_large_tool_payloads(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            rollouts_dir = root / "rollouts"
            rollout_path = _write_rollout_file(rollouts_dir)
            lines = [json.loads(line) for line in rollout_path.read_text().splitlines()]
            large_output = "x" * 5000
            lines[-1]["payload"]["output"] = {"stdout": large_output}
            rollout_path.write_text("\n".join(json.dumps(line) for line in lines))
            os.utime(rollout_path, None)

            db_path = root / "usage.sqlite"
            _run_export(rollouts_dir, db_path, extra_args=["--with-payloads"])

            conn = sqlite3.connect(db_path)
            try:
                row = conn.execute(
                    """
                    SELECT length(output_text), output_length, payload_truncated
                    FROM tool_calls
                    WHERE tool_type = 'function_call_output'
                    """
                ).fetchone()
                self.assertEqual(row[0], 4096)
                self.assertGreater(row[1], row[0])
                self.assertEqual(row[2], 1)
            finally:
                conn.close()

    def test_ingest_rollout_defaults_to_payloads(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            rollouts_dir = root / "rollouts"
            _write_rollout_file(rollouts_dir)
            db_path = root / "usage.sqlite"
            _run_export(rollouts_dir, db_path)

            conn = sqlite3.connect(db_path)
            try:
                tool_calls = conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0]
                messages = conn.execute(
                    "SELECT COUNT(*) FROM content_messages"
                ).fetchone()[0]
                self.assertEqual(tool_calls, 3)
                self.assertEqual(messages, 1)

                tool_rows = conn.execute(
                    "SELECT tool_type, tool_name, call_id, command, input_text, output_text FROM tool_calls ORDER BY captured_at_utc"
                ).fetchall()
                self.assertEqual(tool_rows[0][0], "local_shell")
                self.assertIsNotNone(tool_rows[0][2])
                self.assertIsNotNone(tool_rows[0][3])
                self.assertIsNotNone(tool_rows[0][4])
                self.assertIsNone(tool_rows[0][5])
                self.assertEqual(tool_rows[1][0], "function_call")
                self.assertEqual(tool_rows[1][1], "exec_command")
                self.assertIsNotNone(tool_rows[1][2])
                self.assertIsNone(tool_rows[1][3])
                self.assertIsNotNone(tool_rows[1][4])
                self.assertIsNone(tool_rows[1][5])
                self.assertEqual(tool_rows[2][0], "function_call_output")
                self.assertIsNotNone(tool_rows[2][5])

                events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
                activity_types = {
                    row[0]
                    for row in conn.execute(
                        "SELECT DISTINCT event_type FROM activity_events"
                    ).fetchall()
                }
                self.assertGreater(events, 0)
                self.assertEqual(activity_types, {"user_image", "user_local_image"})
            finally:
                conn.close()

    def test_ingest_workers_default_to_all_cpus(self):
        self.assertEqual(DEFAULT_INGEST_WORKERS, max(1, os.cpu_count() or 1))

    def test_default_ingest_preserves_existing_payloads(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            rollouts_dir = root / "rollouts"
            _write_rollout_file(rollouts_dir)
            db_path = root / "usage.sqlite"

            _run_export(rollouts_dir, db_path, extra_args=["--with-payloads"])
            _run_export(rollouts_dir, db_path)

            conn = sqlite3.connect(db_path)
            try:
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM content_messages").fetchone()[0],
                    1,
                )
                row = conn.execute(
                    """
                    SELECT input_text, output_text
                    FROM tool_calls
                    WHERE tool_type = 'function_call_output'
                    """
                ).fetchone()
                self.assertIsNotNone(row[1])
            finally:
                conn.close()

    def test_ingest_rollout_no_content_redacts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            rollouts_dir = root / "rollouts"
            _write_rollout_file(rollouts_dir)
            db_path = root / "usage.sqlite"
            _run_export(rollouts_dir, db_path, extra_args=["--no-content"])

            conn = sqlite3.connect(db_path)
            try:
                tool_calls = conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0]
                messages = conn.execute(
                    "SELECT COUNT(*) FROM content_messages"
                ).fetchone()[0]
                self.assertEqual(tool_calls, 0)
                self.assertEqual(messages, 0)

                events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
                activity_types = {
                    row[0]
                    for row in conn.execute(
                        "SELECT DISTINCT event_type FROM activity_events"
                    ).fetchall()
                }
                self.assertGreater(events, 0)
                self.assertEqual(activity_types, {"user_image", "user_local_image"})
            finally:
                conn.close()

    def test_storage_profile_migration_cleans_existing_dead_rows_and_vacuums(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "usage.sqlite"
            store = UsageStore(db_path)
            message_rows = []
            tool_rows = []
            activity_rows = []
            for idx in range(1500):
                captured = f"2025-01-01T10:{idx % 60:02d}:00+00:00"
                message_rows.append(
                    MessageEvent(
                        captured_at=captured,
                        captured_at_utc=captured,
                        role="user",
                        message_type="event_msg",
                        message="x" * 200,
                        session_id="session-1",
                        turn_index=1,
                        source="fixture",
                    )
                )
                tool_rows.append(
                    ToolCallEvent(
                        captured_at=captured,
                        captured_at_utc=captured,
                        tool_type="function_call",
                        tool_name="exec_command",
                        call_id=f"call-{idx}",
                        status="completed",
                        input_text='{"cmd":"date"}',
                        output_text=None,
                        command="date",
                        session_id="session-1",
                        turn_index=1,
                        source="fixture",
                    )
                )
                tool_rows.append(
                    ToolCallEvent(
                        captured_at=captured,
                        captured_at_utc=captured,
                        tool_type="function_call_output",
                        tool_name=None,
                        call_id=f"call-{idx}",
                        status=None,
                        input_text=None,
                        output_text='{"stdout":"ok"}',
                        command=None,
                        session_id="session-1",
                        turn_index=1,
                        source="fixture",
                    )
                )
                activity_rows.append(
                    ActivityEvent(
                        captured_at=captured,
                        captured_at_utc=captured,
                        event_type="tool_call",
                        event_name="function",
                        count=1,
                        session_id="session-1",
                        turn_index=1,
                        source="fixture",
                    )
                )
                activity_rows.append(
                    ActivityEvent(
                        captured_at=captured,
                        captured_at_utc=captured,
                        event_type="user_image",
                        event_name="event_msg",
                        count=1,
                        session_id="session-1",
                        turn_index=1,
                        source="fixture",
                    )
                )

            store.insert_messages_bulk(message_rows)
            store.insert_tool_calls_bulk(tool_rows)
            store.insert_activity_events_bulk(activity_rows)
            store.set_meta("storage_profile_version", "0")
            store.close()

            with sqlite3.connect(db_path) as conn:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

            before_size = db_path.stat().st_size

            reopened = UsageStore(db_path)
            reopened.close()

            with sqlite3.connect(db_path) as conn:
                conn.row_factory = sqlite3.Row
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM content_messages").fetchone()[0], 1500
                )
                tool_counts = [
                    tuple(row)
                    for row in conn.execute(
                        "SELECT tool_type, COUNT(*) FROM tool_calls GROUP BY tool_type"
                    ).fetchall()
                ]
                self.assertEqual(tool_counts, [("function_call", 1500)])
                verbose_fields = conn.execute(
                    """
                    SELECT COUNT(*) FROM tool_calls
                    WHERE call_id IS NOT NULL
                       OR input_text IS NOT NULL
                       OR output_text IS NOT NULL
                       OR command IS NOT NULL
                    """
                ).fetchone()[0]
                self.assertEqual(verbose_fields, 0)
                activity_counts = [
                    tuple(row)
                    for row in conn.execute(
                        "SELECT event_type, COUNT(*) FROM activity_events GROUP BY event_type"
                    ).fetchall()
                ]
                self.assertEqual(activity_counts, [("user_image", 1500)])
                storage_version = conn.execute(
                    "SELECT value FROM meta WHERE key = 'storage_profile_version'"
                ).fetchone()[0]
                self.assertEqual(storage_version, "3")

            after_size = db_path.stat().st_size
            self.assertLess(after_size, before_size)


if __name__ == "__main__":
    unittest.main()
