from tempfile import TemporaryDirectory
from unittest import TestCase

from app.config import load_config
from app.core.state import StateStore
from app.models import PlanEntry, Track


class StateStoreTest(TestCase):
    def test_persists_messages_plays_and_plans(self) -> None:
        with TemporaryDirectory() as tmp:
            config = load_config()
            store = StateStore(config, db_path=config.root_dir / tmp / "state.db")
            store.save_message("user", "hello", {"source": "test"})
            store.save_play(
                Track(
                    id="1",
                    neteaseId="1",
                    title="Song",
                    artist="Artist",
                    album="Album",
                    mood="focus",
                    durationSec=180,
                    streamUrl="https://example.com/1.mp3",
                    artworkUrl=None,
                    platformUrl=None,
                    playbackSource="netease",
                ),
                "test reason",
            )
            store.replace_plan(
                "2026-05-07",
                [PlanEntry(id="wake", slot="07:00", title="Wake", summary="Ready", status="ready")],
            )

            self.assertEqual(store.list_recent_messages()[0].content, "hello")
            self.assertEqual(store.list_recent_plays()[0].title, "Song")
            self.assertEqual(store.get_plan("2026-05-07")[0].id, "wake")
            store.close()
