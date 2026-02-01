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
            '{"id":"session-1","timestamp":"2025-01-01T09:59:59.000Z","cwd":"/tmp/project",'
            '"originator":"cli","cli_version":"0.10.0","source":"cli","model_provider":"openai",'
            '"git":{"commit_hash":"abc123","branch":"main","repository_url":"https://example.com/repo.git"}}}'
        )
        parsed, context = parse_rollout_line(session_meta, context)
        self.assertIsNotNone(parsed)
        self.assertIsNotNone(parsed.session_meta)
        self.assertEqual(context.session_id, "session-1")
        self.assertEqual(context.directory, "/tmp/project")
        self.assertEqual(context.codex_version, "0.10.0")

        turn_context = (
            '{"timestamp":"2025-01-01T10:00:01.000Z","type":"turn_context","payload":'
            '{"cwd":"/tmp/project","model":"gpt-5.1","approval_policy":"on-request",'
            '"sandbox_policy":{"type":"workspace-write","writable_roots":["/tmp/extra"],'
            '"network_access":true,"exclude_tmpdir_env_var":true,"exclude_slash_tmp":false},'
            '"effort":"high","summary":"concise","base_instructions":"hello",'
            '"developer_instructions":"","truncation_policy":{"mode":"tokens","limit":2048}}}'
        )
        parsed, context = parse_rollout_line(turn_context, context)
        self.assertIsNotNone(parsed)
        self.assertEqual(context.model, "gpt-5.1")
        self.assertEqual(parsed.turn_context.approval_policy, "on-request")
        self.assertEqual(parsed.turn_context.sandbox_policy_type, "workspace-write")
        self.assertTrue(parsed.turn_context.sandbox_network_access)
        self.assertTrue(parsed.turn_context.has_base_instructions)
        self.assertFalse(parsed.turn_context.has_user_instructions)
        self.assertFalse(parsed.turn_context.has_developer_instructions)
        self.assertEqual(parsed.turn_context.truncation_policy_mode, "tokens")
        self.assertEqual(parsed.turn_context.truncation_policy_limit, 2048)

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
                    "credits": {
                        "has_credits": True,
                        "unlimited": False,
                        "balance": "3.50",
                    },
                    "plan_type": "pro",
                },
            },
        }
        token_count = __import__("json").dumps(token_count_payload)
        parsed, context = parse_rollout_line(token_count, context)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.token_count.tokens["total_tokens"], 25)
        self.assertEqual(parsed.token_count.tokens["input_tokens"], 20)
        self.assertEqual(parsed.token_count.tokens["output_tokens"], 5)
        self.assertEqual(parsed.token_count.context_used, 17000)
        self.assertEqual(parsed.token_count.context_total, 22000)
        self.assertEqual(parsed.token_count.context_percent_left, 50)
        self.assertEqual(parsed.token_count.limit_5h_percent_left, 80.0)
        self.assertEqual(parsed.token_count.limit_weekly_percent_left, 90.0)
        self.assertEqual(parsed.token_count.lifetime_tokens["total_tokens"], 17000)
        self.assertEqual(parsed.token_count.rate_limit_plan_type, "pro")

        event_payload = {
            "timestamp": "2025-01-01T10:00:03.000Z",
            "type": "event_msg",
            "payload": {"type": "context_compacted"},
        }
        event_line = __import__("json").dumps(event_payload)
        parsed, context = parse_rollout_line(event_line, context)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.event_marker.event_type, "context_compacted")


if __name__ == "__main__":
    unittest.main()
