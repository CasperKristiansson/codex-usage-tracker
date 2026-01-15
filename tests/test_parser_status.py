import unittest
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1] / "src"))

from codex_usage_tracker.parser import parse_status_panel


class StatusParserTests(unittest.TestCase):
    def test_parses_status_panel(self):
        panel = "\n".join(
            [
                "\u256d\u2500\u2500\u2500\u256e",
                "\u2502  OpenAI Codex (v0.10.2) \u2502",
                "\u2502  Model: gpt-5.1 (fast) \u2502",
                "\u2502  Directory: ~/proj \u2502",
                "\u2502  Session: abc123 \u2502",
                "\u2502  Token usage: 1.9K total (1K input + 900 output) \u2502",
                "\u2502  Context window: 61% left (108K used / 258K) \u2502",
                "\u2502  5h limit: [\u2588\u2588\u2591] 12% left (resets 18:34) \u2502",
                "\u2502  Weekly limit: [\u2588\u2588] 80% left \u2502",
                "\u2502    (resets 12:00 on 16 Jan) \u2502",
                "\u2570\u2500\u2500\u2500\u256f",
            ]
        )

        snapshot = parse_status_panel(panel)
        self.assertEqual(snapshot.codex_version, "0.10.2")
        self.assertEqual(snapshot.model, "gpt-5.1 (fast)")
        self.assertEqual(snapshot.directory, "~/proj")
        self.assertEqual(snapshot.session_id, "abc123")
        self.assertEqual(snapshot.token_usage["total_tokens"], 1900)
        self.assertEqual(snapshot.token_usage["input_tokens"], 1000)
        self.assertEqual(snapshot.token_usage["output_tokens"], 900)
        self.assertEqual(snapshot.context_window["percent_left"], 61)
        self.assertEqual(snapshot.context_window["used_tokens"], 108000)
        self.assertEqual(snapshot.context_window["total_tokens"], 258000)
        self.assertIn("5h limit", snapshot.limits)
        self.assertEqual(snapshot.limits["5h limit"]["percent_left"], 12)
        self.assertEqual(snapshot.limits["5h limit"]["resets"], "18:34")
        self.assertIn("weekly limit", snapshot.limits)
        self.assertEqual(snapshot.limits["weekly limit"]["percent_left"], 80)
        self.assertEqual(
            snapshot.limits["weekly limit"]["resets"], "12:00 on 16 Jan"
        )


if __name__ == "__main__":
    unittest.main()
