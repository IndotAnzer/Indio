from __future__ import annotations

from models import CalendarEvent


class CalendarAdapter:
    async def get_events_for_today(self) -> list[CalendarEvent]:
        return [
            CalendarEvent(
                id="focus-block",
                title="深度工作时段",
                start_at="09:30",
                end_at="11:30",
            )
        ]
