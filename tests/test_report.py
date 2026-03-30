import unittest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from codex_usage_tracker.report import ReportRow, parse_last, render_table


class ReportTests(unittest.TestCase):
    def test_parse_last_supports_months_minutes_and_total(self):
        tz = ZoneInfo("Europe/Stockholm")
        now = datetime(2026, 3, 30, 12, 0, tzinfo=tz)

        month_start, month_end = parse_last("1m", now)
        self.assertEqual(month_start, datetime(2026, 2, 28, 12, 0, tzinfo=tz))
        self.assertEqual(month_end, now)

        minute_start, minute_end = parse_last("30min", now)
        self.assertEqual(minute_start, now - timedelta(minutes=30))
        self.assertEqual(minute_end, now)

        total_start, total_end = parse_last("total", now)
        self.assertIsNone(total_start)
        self.assertIsNone(total_end)

    def test_render_table_appends_total_footer(self):
        rows = [
            ReportRow(
                period="2026-03-01",
                group="all",
                total_tokens=120,
                input_tokens=50,
                cached_input_tokens=10,
                output_tokens=60,
                reasoning_output_tokens=5,
                estimated_cost=1.25,
            ),
            ReportRow(
                period="2026-03-02",
                group="all",
                total_tokens=180,
                input_tokens=80,
                cached_input_tokens=20,
                output_tokens=80,
                reasoning_output_tokens=7,
                estimated_cost=2.50,
            ),
        ]

        output = render_table(rows, include_group=False)
        total_line = output.splitlines()[-1]

        self.assertEqual(
            total_line.split(),
            ["Total", "300", "130", "30", "140", "12", "$3.75"],
        )

    def test_render_table_appends_total_footer_for_grouped_reports(self):
        rows = [
            ReportRow(
                period="2026-03-01",
                group="gpt-5.4",
                total_tokens=120,
                input_tokens=50,
                cached_input_tokens=10,
                output_tokens=60,
                reasoning_output_tokens=5,
                estimated_cost=1.25,
            ),
            ReportRow(
                period="2026-03-01",
                group="gpt-5.2",
                total_tokens=180,
                input_tokens=80,
                cached_input_tokens=20,
                output_tokens=80,
                reasoning_output_tokens=7,
                estimated_cost=2.50,
            ),
        ]

        output = render_table(rows, include_group=True)
        total_line = output.splitlines()[-1]

        self.assertIn("Total", total_line)
        self.assertIn("300", total_line)
        self.assertIn("130", total_line)
        self.assertIn("30", total_line)
        self.assertIn("140", total_line)
        self.assertIn("12", total_line)
        self.assertIn("$3.75", total_line)


if __name__ == "__main__":
    unittest.main()
