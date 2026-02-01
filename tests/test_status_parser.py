import unittest
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1] / "src"))

from codex_usage_tracker.parser import StatusCapture, parse_token_usage_line


class StatusParserTests(unittest.TestCase):
    def test_status_capture_snapshot(self):
        lines = [
            "/status",
            "\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e",
            "\u2502 OpenAI Codex (v0.10.0)   \u2502",
            "\u2502 Model: gpt-5.1-codex     \u2502",
            "\u2502 Directory: /tmp/project  \u2502",
            "\u2502 Session: session-1       \u2502",
            "\u2502 Token usage: 12.3K total (10K input + 2.3K output) \u2502",
            "\u2502 Context window: 70% left (8K used / 28K) \u2502",
            "\u2502 5h limit: [####] 80% left (resets 14:00) \u2502",
            "\u2502 Weekly limit: 90% left (resets 14:00 on 16 Jan) \u2502",
            "\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f",
        ]
        capture = StatusCapture()
        snapshot = None
        for line in lines:
            snapshot = capture.feed_line(line)
        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot.codex_version, "0.10.0")
        self.assertEqual(snapshot.model, "gpt-5.1-codex")
        self.assertEqual(snapshot.directory, "/tmp/project")
        self.assertEqual(snapshot.session_id, "session-1")
        self.assertEqual(snapshot.token_usage.get("total_tokens"), 12300)
        self.assertEqual(snapshot.token_usage.get("input_tokens"), 10000)
        self.assertEqual(snapshot.token_usage.get("output_tokens"), 2300)
        self.assertEqual(snapshot.context_window.get("percent_left"), 70)
        self.assertEqual(snapshot.context_window.get("used_tokens"), 8000)
        self.assertEqual(snapshot.context_window.get("total_tokens"), 28000)
        self.assertIn("5h limit", snapshot.limits)
        self.assertIn("weekly limit", snapshot.limits)

    def test_parse_token_usage_line(self):
        line = "Token usage: total=1,200 input=900 (+ 100 cached) output=300 (reasoning 50)"
        parsed = parse_token_usage_line(line)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["total_tokens"], 1200)
        self.assertEqual(parsed["input_tokens"], 900)
        self.assertEqual(parsed["cached_input_tokens"], 100)
        self.assertEqual(parsed["output_tokens"], 300)
        self.assertEqual(parsed["reasoning_output_tokens"], 50)


if __name__ == "__main__":
    unittest.main()
