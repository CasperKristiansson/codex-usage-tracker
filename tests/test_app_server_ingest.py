import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1] / "src"))

from codex_usage_tracker.app_server import ingest_app_server_output
from codex_usage_tracker.store import UsageStore


class AppServerIngestTests(unittest.TestCase):
    def test_ingests_turns_items_and_web_actions(self):
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

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "usage.sqlite"
            log_path = Path(tmpdir) / "app.log"
            log_path.write_text("\n".join(json.dumps(line) for line in log_lines))

            store = UsageStore(db_path)
            stats = ingest_app_server_output(log_path, store)
            self.assertEqual(stats.turns, 1)
            self.assertEqual(stats.items, 2)
            self.assertEqual(stats.web_actions, 1)

            turns = store.conn.execute("SELECT * FROM app_turns").fetchall()
            self.assertEqual(len(turns), 1)
            self.assertEqual(turns[0]["turn_id"], "turn-1")
            self.assertEqual(turns[0]["status"], "completed")

            items = store.conn.execute(
                "SELECT * FROM app_items ORDER BY id"
            ).fetchall()
            self.assertEqual(len(items), 3)
            command_item = items[0]
            self.assertEqual(command_item["item_type"], "commandExecution")
            self.assertEqual(command_item["command_name"], "git")
            self.assertEqual(command_item["exit_code"], 0)
            self.assertEqual(command_item["output_bytes"], 5)
            web_item = items[1]
            self.assertEqual(web_item["item_type"], "webSearch")
            self.assertEqual(web_item["web_search_action"], "search")
            action_item = items[2]
            self.assertEqual(action_item["item_type"], "web_search_action")
            self.assertEqual(action_item["web_search_action"], "open_page")
            store.close()


if __name__ == "__main__":
    unittest.main()
