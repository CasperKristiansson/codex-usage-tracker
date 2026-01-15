import unittest
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1] / "src"))

from codex_usage_tracker.parser import parse_token_usage_line


class TokenUsageParserTests(unittest.TestCase):
    def test_parses_basic_usage(self):
        line = "Token usage: total=2 input=0 output=2"
        result = parse_token_usage_line(line)
        self.assertEqual(
            result,
            {
                "total_tokens": 2,
                "input_tokens": 0,
                "cached_input_tokens": 0,
                "output_tokens": 2,
                "reasoning_output_tokens": 0,
            },
        )

    def test_parses_cached_usage(self):
        line = "Token usage: total=10,857 input=10,562 (+ 48,000 cached) output=295"
        result = parse_token_usage_line(line)
        self.assertEqual(result["total_tokens"], 10857)
        self.assertEqual(result["input_tokens"], 10562)
        self.assertEqual(result["cached_input_tokens"], 48000)
        self.assertEqual(result["output_tokens"], 295)

    def test_parses_reasoning_usage(self):
        line = "Token usage: total=120 input=100 output=20 (reasoning 5)"
        result = parse_token_usage_line(line)
        self.assertEqual(result["reasoning_output_tokens"], 5)


if __name__ == "__main__":
    unittest.main()
