import unittest

from codex_usage_tracker.report import default_pricing, estimate_event_cost


class TestPricingModels(unittest.TestCase):
    def test_default_pricing_includes_expected_models(self):
        pricing = default_pricing()
        for model in (
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.2-codex",
            "gpt-5-codex",
            "gpt-5.1-codex-max",
            "gpt-5.1-codex-mini",
            "gpt-5.2",
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5.5",
            "gpt-5.2-pro",
            "gpt-5.4-pro",
            "gpt-5.5-pro",
            "gpt-5.1-codex",
            "gpt-5.3-codex",
            "gpt-5",
        ):
            self.assertIn(model, pricing.models)

    def test_estimate_event_cost_supports_expected_models(self):
        pricing = default_pricing()
        for model in (
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.2-codex",
            "gpt-5-codex",
            "gpt-5.1-codex-max",
            "gpt-5.1-codex-mini",
            "gpt-5.2",
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5.5",
            "gpt-5.2-pro",
            "gpt-5.4-pro",
            "gpt-5.5-pro",
            "gpt-5.1-codex",
            "gpt-5.3-codex",
            "gpt-5",
        ):
            cost = estimate_event_cost(
                {
                    "model": model,
                    "input_tokens": 1000,
                    "cached_input_tokens": 200,
                    "output_tokens": 300,
                },
                pricing,
            )
            self.assertIsNotNone(cost, msg=f"missing cost for model={model!r}")

    def test_default_rates_include_mini_models(self):
        pricing = default_pricing()
        expected_rates = {
            "gpt-5.1-codex-mini": (0.25, 0.025, 2.0),
            "gpt-5.4-mini": (0.75, 0.075, 4.5),
        }
        for model, expected in expected_rates.items():
            rates = pricing.models[model]
            self.assertEqual(
                (rates.input_rate, rates.cached_input_rate, rates.output_rate),
                expected,
            )

    def test_auto_review_uses_gpt_5_3_codex_pricing(self):
        cost = estimate_event_cost(
            {
                "model": "codex-auto-review",
                "input_tokens": 1_000_000,
                "cached_input_tokens": 0,
                "output_tokens": 0,
            },
            default_pricing(),
        )
        self.assertEqual(cost, 1.75)

    def test_default_rates_include_gpt_5_6_family(self):
        pricing = default_pricing()
        expected_rates = {
            "gpt-5.6-sol": (5.0, 0.5, 30.0),
            "gpt-5.6-terra": (2.5, 0.25, 15.0),
            "gpt-5.6-luna": (1.0, 0.1, 6.0),
        }
        for model, expected in expected_rates.items():
            rates = pricing.models[model]
            self.assertEqual(
                (rates.input_rate, rates.cached_input_rate, rates.output_rate),
                expected,
            )

    def test_default_rates_include_gpt_5_5_family(self):
        pricing = default_pricing()
        self.assertEqual(pricing.models["gpt-5.5"].input_rate, 5.0)
        self.assertEqual(pricing.models["gpt-5.5"].cached_input_rate, 0.5)
        self.assertEqual(pricing.models["gpt-5.5"].output_rate, 30.0)
        self.assertEqual(pricing.models["gpt-5.5-pro"].input_rate, 30.0)
        self.assertEqual(pricing.models["gpt-5.5-pro"].cached_input_rate, 30.0)
        self.assertEqual(pricing.models["gpt-5.5-pro"].output_rate, 180.0)
        self.assertEqual(pricing.models["gpt-5"].input_rate, 5.0)

    def test_model_aliases_and_cleanup(self):
        pricing = default_pricing()
        # If some source includes decorations or a dated suffix, we should still
        # produce a cost rather than dropping coverage.
        for model in (
            "gpt-5.3-codex (fast)",
            "gpt-5.2-codex-2026-01-15",
            "gpt-5.5-2026-04-24",
            "gpt-5-pro",
            "codex-auto-review",
        ):
            cost = estimate_event_cost(
                {
                    "model": model,
                    "input_tokens": 1000,
                    "cached_input_tokens": 0,
                    "output_tokens": 0,
                },
                pricing,
            )
            self.assertIsNotNone(cost, msg=f"expected alias/cleanup for {model!r}")


if __name__ == "__main__":
    unittest.main()
