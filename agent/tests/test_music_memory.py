import json
import tempfile
import unittest
from pathlib import Path

import music_memory


def _paths(root):
    directory = root / "memory"
    return music_memory.MemoryPaths(
        directory=directory,
        taste=directory / "TASTE.md",
        habit=directory / "HABIT.md",
        habit_events=directory / "HABIT_EVENTS.jsonl",
        meta=directory / "MEMORY_META.json",
    )


class MusicMemoryTest(unittest.TestCase):
    def setUp(self):
        self._original_memory_paths = music_memory._memory_paths
        self._original_maybe_update = music_memory.maybe_update_habit_profile

    def tearDown(self):
        music_memory._memory_paths = self._original_memory_paths
        music_memory.maybe_update_habit_profile = self._original_maybe_update

    def test_record_habit_event_ignores_automatic_advance(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = _paths(Path(tmp))
            music_memory._memory_paths = lambda user_id=None: paths

            def fail_summary(**kwargs):
                raise AssertionError("summary should not run")

            music_memory.maybe_update_habit_profile = fail_summary

            recorded = music_memory.record_habit_event(
                request="下一首",
                track={"trackId": "150528", "title": "爱，很简单", "artist": "陶喆"},
                action="advance",
                user_id="local",
            )

            self.assertFalse(recorded)
            self.assertFalse(paths.habit_events.exists())

    def test_record_habit_event_records_user_radio_turn(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = _paths(Path(tmp))
            music_memory._memory_paths = lambda user_id=None: paths
            music_memory.maybe_update_habit_profile = lambda **kwargs: False

            recorded = music_memory.record_habit_event(
                request="随便推荐一首歌",
                track={"trackId": "65766", "title": "富士山下", "artist": "陈奕迅"},
                action="turn",
                user_id="local",
            )

            self.assertTrue(recorded)
            events = [json.loads(line) for line in paths.habit_events.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["action"], "turn")
            self.assertEqual(events[0]["request"], "随便推荐一首歌")
            self.assertEqual(events[0]["track"]["trackId"], "65766")


if __name__ == "__main__":
    unittest.main()
