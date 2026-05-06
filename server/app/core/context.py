from __future__ import annotations

import json

from app.adapters.calendar import CalendarAdapter
from app.adapters.weather import WeatherAdapter
from app.config import AppConfig
from app.core.state import StateStore
from app.models import ContextBundle, TriggerSource, UserProfile, utc_now_iso


class ContextService:
    def __init__(
        self,
        config: AppConfig,
        state: StateStore,
        weather: WeatherAdapter,
        calendar: CalendarAdapter,
    ) -> None:
        self.config = config
        self.state = state
        self.weather = weather
        self.calendar = calendar

    async def load_profile(self) -> UserProfile:
        taste = (self.config.user_dir / "taste.md").read_text(encoding="utf-8")
        routines = (self.config.user_dir / "routines.md").read_text(encoding="utf-8")
        mood_rules = (self.config.user_dir / "mood-rules.md").read_text(encoding="utf-8")
        playlists = json.loads((self.config.user_dir / "playlists.json").read_text(encoding="utf-8"))
        return UserProfile(taste=taste, routines=routines, mood_rules=mood_rules, playlists=playlists)

    async def build(self, *, source: TriggerSource, user_input: str | None = None) -> ContextBundle:
        profile = await self.load_profile()
        return ContextBundle(
            system_prompt=self.config.prompt_path.read_text(encoding="utf-8"),
            profile=profile,
            weather=await self.weather.get_snapshot(),
            calendar=await self.calendar.get_events_for_today(),
            recent_messages=self.state.list_recent_messages(6),
            recent_plays=self.state.list_recent_plays(4),
            current_time=utc_now_iso(),
            source=source,
            user_input=user_input,
        )

    async def get_taste_summary(self) -> dict[str, object]:
        profile = await self.load_profile()

        def highlights(value: str) -> list[str]:
            return [
                line.removeprefix("-").strip()
                for line in value.splitlines()
                if line.strip().startswith("-")
            ][:4]

        return {
            "tasteHighlights": highlights(profile.taste),
            "routineHighlights": highlights(profile.routines),
            "playlists": [playlist.model_dump(mode="json", by_alias=True) for playlist in profile.playlists],
        }
