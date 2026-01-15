import unittest
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1] / "src"))

from codex_usage_tracker.rollout import RolloutContext, parse_rollout_line


class RolloutParseTests(unittest.TestCase):
    def test_parses_token_count_event(self):
        context = RolloutContext()
        session_meta = (
            '{"timestamp":"2025-01-01T10:00:00.000Z","type":"session_meta","payload":'
            '{"id":"session-1","cwd":"/tmp/project","cli_version":"0.10.0"}}'
        )
        parsed, context = parse_rollout_line(session_meta, context)
        self.assertIsNone(parsed)
        self.assertEqual(context.session_id, "session-1")
        self.assertEqual(context.directory, "/tmp/project")
        self.assertEqual(context.codex_version, "0.10.0")

        turn_context = (
            '{"timestamp":"2025-01-01T10:00:01.000Z","type":"turn_context","payload":'
            '{"cwd":"/tmp/project","model":"gpt-5.1"}}'
        )
        parsed, context = parse_rollout_line(turn_context, context)
        self.assertIsNone(parsed)
        self.assertEqual(context.model, "gpt-5.1")

        token_count_payload = {
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
                },
            },
        }
        token_count = __import__("json").dumps(token_count_payload)
        parsed, context = parse_rollout_line(token_count, context)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.tokens["total_tokens"], 25)
        self.assertEqual(parsed.tokens["input_tokens"], 20)
        self.assertEqual(parsed.tokens["output_tokens"], 5)
        self.assertEqual(parsed.context_used, 17000)
        self.assertEqual(parsed.context_total, 22000)
        self.assertEqual(parsed.context_percent_left, 50)
        self.assertEqual(parsed.limit_5h_percent_left, 80.0)
        self.assertEqual(parsed.limit_weekly_percent_left, 90.0)


if __name__ == "__main__":
    unittest.main()
