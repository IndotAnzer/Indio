from unittest import TestCase

from app.core.router import RoutedControl, RoutedPlan, RouterService


class RouterServiceTest(TestCase):
    def test_routes_direct_playback_controls_locally(self) -> None:
        router = RouterService()
        routed = router.route("下一首", None)

        self.assertIsInstance(routed, RoutedControl)
        assert isinstance(routed, RoutedControl)
        self.assertEqual(routed.decision.provider.kind, "local-control")
        self.assertEqual(routed.decision.play[0].query, "focus")

    def test_extracts_mood_hints_without_control_decision(self) -> None:
        router = RouterService()
        routed = router.route("给我一段适合写代码的专注流", None)

        self.assertIsInstance(routed, RoutedPlan)
        assert isinstance(routed, RoutedPlan)
        self.assertEqual(routed.mood_hint, "focus")
