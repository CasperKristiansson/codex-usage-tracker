import unittest

from codex_usage_tracker.report import default_pricing, estimate_event_cost


class TestPricingModels(unittest.TestCase):
    def test_default_pricing_includes_expected_models(self):
        pricing = default_pricing()
        for model in (
            "gpt-5.2-codex",
            "gpt-5-codex",
            "gpt-5.1-codex-max",
            "gpt-5.2",
            "gpt-5.4",
            "gpt-5.2-pro",
            "gpt-5.4-pro",
            "gpt-5.1-codex",
            "gpt-5.3-codex",
            "gpt-5",
        ):
            self.assertIn(model, pricing.models)

    def test_estimate_event_cost_supports_expected_models(self):
        pricing = default_pricing()
        for model in (
            "gpt-5.2-codex",
            "gpt-5-codex",
            "gpt-5.1-codex-max",
            "gpt-5.2",
            "gpt-5.4",
            "gpt-5.2-pro",
            "gpt-5.4-pro",
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

    def test_default_rates_include_gpt_5_4_family(self):
        pricing = default_pricing()
        self.assertEqual(pricing.models["gpt-5.4"].input_rate, 2.5)
        self.assertEqual(pricing.models["gpt-5.4"].cached_input_rate, 0.25)
        self.assertEqual(pricing.models["gpt-5.4"].output_rate, 15.0)
        self.assertEqual(pricing.models["gpt-5.4-pro"].input_rate, 30.0)
        self.assertEqual(pricing.models["gpt-5.4-pro"].cached_input_rate, 30.0)
        self.assertEqual(pricing.models["gpt-5.4-pro"].output_rate, 180.0)

    def test_model_aliases_and_cleanup(self):
        pricing = default_pricing()
        # If some source includes decorations or a dated suffix, we should still
        # produce a cost rather than dropping coverage.
        for model in (
            "gpt-5.3-codex (fast)",
            "gpt-5.2-codex-2026-01-15",
            "gpt-5-pro",
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
