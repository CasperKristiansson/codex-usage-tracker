import json
import os
import tempfile
import unittest
from pathlib import Path
import sys
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = str(ROOT / "src")


def _run_export(rollouts_dir: Path, db_path: Path, no_content: bool = False) -> None:
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
    if no_content:
        command.append("--no-content")
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
            _run_export(rollouts_dir, db_path, no_content=False)

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
                self.assertIn("user_message", activity_types)
                self.assertIn("tool_call", activity_types)

                tool_row = conn.execute(
                "SELECT tool_type, command FROM tool_calls"
                ).fetchone()
                self.assertIsNotNone(tool_row)
                self.assertEqual(tool_row[0], "local_shell")
                self.assertIn("git", tool_row[1] or "")

                message_row = conn.execute(
                "SELECT role, message_type, message FROM content_messages"
                ).fetchone()
                self.assertIsNotNone(message_row)
                self.assertEqual(message_row[0], "user")
                self.assertEqual(message_row[1], "event_msg")
                self.assertEqual(message_row[2], "hi")
            finally:
                conn.close()

    def test_ingest_rollout_no_content_redacts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            rollouts_dir = root / "rollouts"
            _write_rollout_file(rollouts_dir)
            db_path = root / "usage.sqlite"
            _run_export(rollouts_dir, db_path, no_content=True)

            conn = sqlite3.connect(db_path)
            try:
                tool_calls = conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0]
                messages = conn.execute(
                    "SELECT COUNT(*) FROM content_messages"
                ).fetchone()[0]
                self.assertEqual(tool_calls, 0)
                self.assertEqual(messages, 0)

                events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
                activity = conn.execute(
                    "SELECT COUNT(*) FROM activity_events"
                ).fetchone()[0]
                self.assertGreater(events, 0)
                self.assertGreater(activity, 0)
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
