import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = str(ROOT / "src")
DEFAULT_TIMEZONE = "Europe/Stockholm"


def _run_cli(args: list[str], env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    merged_env = os.environ.copy()
    merged_env["PYTHONPATH"] = f"{SRC_PATH}{os.pathsep}{merged_env.get('PYTHONPATH', '')}"
    if env:
        merged_env.update(env)
    return subprocess.run(
        [sys.executable, "-m", "codex_usage_tracker.cli", *args],
        check=True,
        env=merged_env,
        capture_output=True,
        text=True,
    )


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _write_rollout_for_today(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    tz = ZoneInfo(DEFAULT_TIMEZONE)
    now_local = datetime.now(tz)
    base = now_local - timedelta(seconds=1)
    if base.date() != now_local.date():
        base = now_local
    timestamp = _iso_z(base)
    rollout_path = root / f"rollout-{base.strftime('%Y-%m-%d')}.jsonl"
    lines = [
        {
            "timestamp": timestamp,
            "type": "session_meta",
            "payload": {
                "id": "session-1",
                "timestamp": timestamp,
                "cwd": "/tmp/project",
                "originator": "cli",
                "cli_version": "0.10.0",
                "source": "cli",
                "model_provider": "openai",
            },
        },
        {
            "timestamp": timestamp,
            "type": "turn_context",
            "payload": {
                "cwd": "/tmp/project",
                "model": "gpt-5.1-codex",
                "approval_policy": "on-request",
                "sandbox_policy": {
                    "type": "workspace-write",
                    "writable_roots": ["/tmp/extra"],
                    "network_access": True,
                },
            },
        },
        {
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 1000,
                        "cached_input_tokens": 100,
                        "output_tokens": 200,
                        "reasoning_output_tokens": 0,
                        "total_tokens": 1300,
                    },
                    "last_token_usage": {
                        "input_tokens": 120,
                        "cached_input_tokens": 10,
                        "output_tokens": 30,
                        "reasoning_output_tokens": 0,
                        "total_tokens": 160,
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
                },
            },
        },
    ]
    rollout_path.write_text("\n".join(json.dumps(line) for line in lines))
    return rollout_path


class CliIntegrationTests(unittest.TestCase):
    def test_cli_report_today_outputs_table_headers(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            rollouts_dir = root / "rollouts"
            _write_rollout_for_today(rollouts_dir)
            db_path = root / "usage.sqlite"

            result = _run_cli(
                [
                    "report",
                    "--db",
                    str(db_path),
                    "--rollouts",
                    str(rollouts_dir),
                    "--today",
                ]
            )
            output = result.stdout.strip().splitlines()
            header_line = next((line for line in output if line.startswith("Period")), "")
            self.assertTrue(header_line)
            for label in ("Period", "Total", "Input", "Cached", "Output", "Reasoning", "Est. cost"):
                self.assertIn(label, header_line)
            header_index = output.index(header_line)
            self.assertGreaterEqual(len(output), header_index + 3)

    def test_cli_export_csv_writes_event_rows(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            rollouts_dir = root / "rollouts"
            _write_rollout_for_today(rollouts_dir)
            db_path = root / "usage.sqlite"
            out_path = root / "events.csv"

            _run_cli(
                [
                    "export",
                    "--db",
                    str(db_path),
                    "--rollouts",
                    str(rollouts_dir),
                    "--format",
                    "csv",
                    "--out",
                    str(out_path),
                ]
            )
            content = out_path.read_text(encoding="utf-8")
            self.assertIn("event_type", content)
            self.assertIn("token_count", content)

    def test_cli_status_uses_latest_snapshot_fields(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            db_path = root / "usage.sqlite"
            rollouts_dir = root / "rollouts"
            rollouts_dir.mkdir()
            log_path = root / "cli.log"
            log_lines = [
                "Token usage: total=1,200 input=900 (+ 100 cached) output=300 (reasoning 50)",
                "/status",
                "\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e",
                "\u2502 OpenAI Codex (v0.10.0)   \u2502",
                "\u2502 Model: gpt-5.1-codex     \u2502",
                "\u2502 Directory: /tmp/project  \u2502",
                "\u2502 Session: session-1       \u2502",
                "\u2502 Token usage: 12.3K total (10K input + 2.3K output) \u2502",
                "\u2502 Context window: 70% left (8K used / 28K) \u2502",
                "\u2502 5h limit: [####] 80% left (resets 14:00) \u2502",
                "\u2502 Weekly limit: 90% left (resets 14:00 on 16 Jan) \u2502",
                "\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f",
            ]
            log_path.write_text("\n".join(log_lines))

            ingest = _run_cli(
                ["ingest-cli", "--db", str(db_path), "--log", str(log_path)]
            )
            self.assertIn("status snapshots", ingest.stdout)

            status = _run_cli(
                [
                    "status",
                    "--db",
                    str(db_path),
                    "--rollouts",
                    str(rollouts_dir),
                ]
            )
            output = status.stdout
            self.assertIn("Model: gpt-5.1-codex", output)
            self.assertIn("Directory: /tmp/project", output)
            self.assertIn("Session: session-1", output)
            self.assertIn("Token usage:", output)
            self.assertIn("Context window:", output)

    def test_cli_ingest_app_server_log(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            db_path = root / "usage.sqlite"
            log_path = root / "app.log"
            log_lines = [
                {
                    "method": "turn/started",
                    "params": {
                        "threadId": "thread-1",
                        "turn": {"id": "turn-1", "status": "inProgress", "items": []},
                    },
                },
                {
                    "method": "item/started",
                    "params": {
                        "threadId": "thread-1",
                        "turnId": "turn-1",
                        "item": {
                            "type": "commandExecution",
                            "id": "item-1",
                            "command": "git status",
                            "status": "inProgress",
                        },
                    },
                },
                {
                    "method": "item/commandExecution/outputDelta",
                    "params": {
                        "threadId": "thread-1",
                        "turnId": "turn-1",
                        "itemId": "item-1",
                        "delta": "hello",
                    },
                },
                {
                    "method": "item/completed",
                    "params": {
                        "threadId": "thread-1",
                        "turnId": "turn-1",
                        "item": {
                            "type": "commandExecution",
                            "id": "item-1",
                            "command": "git status",
                            "status": "completed",
                            "exitCode": 0,
                        },
                    },
                },
                {
                    "method": "item/started",
                    "params": {
                        "threadId": "thread-1",
                        "turnId": "turn-1",
                        "item": {
                            "type": "webSearch",
                            "id": "item-2",
                            "query": "cats",
                        },
                    },
                },
                {
                    "method": "item/completed",
                    "params": {
                        "threadId": "thread-1",
                        "turnId": "turn-1",
                        "item": {
                            "type": "webSearch",
                            "id": "item-2",
                            "query": "cats",
                        },
                    },
                },
                {
                    "method": "rawResponseItem/completed",
                    "params": {
                        "threadId": "thread-1",
                        "turnId": "turn-1",
                        "item": {
                            "type": "web_search_call",
                            "action": {"type": "open_page", "url": "https://example.com"},
                        },
                    },
                },
                {
                    "method": "turn/completed",
                    "params": {
                        "threadId": "thread-1",
                        "turn": {"id": "turn-1", "status": "completed", "items": []},
                    },
                },
            ]
            log_path.write_text("\n".join(json.dumps(line) for line in log_lines))

            ingest = _run_cli(
                ["ingest-app-server", "--db", str(db_path), "--log", str(log_path)]
            )
            self.assertIn("Ingested", ingest.stdout)

            conn = sqlite3.connect(db_path)
            try:
                turns = conn.execute("SELECT * FROM app_turns").fetchall()
                items = conn.execute("SELECT * FROM app_items").fetchall()
                self.assertEqual(len(turns), 1)
                self.assertGreaterEqual(len(items), 3)
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
